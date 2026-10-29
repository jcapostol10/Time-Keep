import "server-only";

import { randomUUID } from "node:crypto";

import { can, type EntryDetails, TASK_UNAVAILABLE_MESSAGE, trackingBlock } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  eq,
  favoriteEntry,
  inArray,
  project,
  tag,
  task,
  taskGroup,
} from "@timekeep/db";

import type { FavoriteDTO } from "@/lib/favorite-types";

import { WorkspaceAccessError } from "./access-error";
import { projectResource } from "./authz";
import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";

/**
 * Favourites: a person's pinned entry details (description, project, task,
 * tags, billable), at most 20, oldest first. The tracker starts timers from
 * them; one whose project is archived or no longer visible is listed but
 * blocked, with the reason, as `trackingBlock` gives it.
 */

export const MAX_FAVORITES = 20;

type Executor = Pick<Database, "query" | "select" | "insert" | "delete">;
type Details = Omit<EntryDetails, "type">;

/** The groups of each task, for `task.trackTime` (decision 11). */
async function groupsOfTasks(db: Executor, taskIds: string[]): Promise<Map<string, string[]>> {
  const groups = new Map<string, string[]>();
  if (taskIds.length === 0) return groups;
  const rows = await db
    .select({ taskId: taskGroup.taskId, groupId: taskGroup.groupId })
    .from(taskGroup)
    .where(inArray(taskGroup.taskId, taskIds));
  for (const r of rows) groups.set(r.taskId, [...(groups.get(r.taskId) ?? []), r.groupId]);
  return groups;
}

function mayTrack(viewer: Viewer, t: { id: string; projectId: string }, groups: Map<string, string[]>) {
  return can(viewer.actor, "task.trackTime", {
    kind: "task",
    projectId: t.projectId,
    groupIds: groups.get(t.id) ?? [],
  });
}

function sameDetails(a: Details, b: Details): boolean {
  const tags = (ids: string[]) => [...new Set(ids)].sort().join(",");
  return (
    a.description.trim() === b.description.trim() &&
    a.projectId === b.projectId &&
    a.taskId === b.taskId &&
    a.billable === b.billable &&
    tags(a.tagIds) === tags(b.tagIds)
  );
}

export async function listFavorites(db: Executor, viewer: Viewer): Promise<FavoriteDTO[]> {
  const rows = await db
    .select()
    .from(favoriteEntry)
    .where(
      and(
        eq(favoriteEntry.workspaceId, viewer.workspaceId),
        eq(favoriteEntry.userId, viewer.userId),
      ),
    )
    .orderBy(asc(favoriteEntry.createdAt), asc(favoriteEntry.id));
  if (rows.length === 0) return [];

  const projectIds = [...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
  const taskIds = [...new Set(rows.flatMap((r) => (r.taskId ? [r.taskId] : [])))];
  const tagIds = [...new Set(rows.flatMap((r) => r.tagIds))];
  const [projects, tasks, tags] = await Promise.all([
    projectIds.length > 0
      ? db.query.project.findMany({
          where: and(inArray(project.id, projectIds), eq(project.workspaceId, viewer.workspaceId)),
          with: { client: { columns: { name: true } } },
        })
      : [],
    taskIds.length > 0
      ? db.query.task.findMany({
          where: and(inArray(task.id, taskIds), eq(task.workspaceId, viewer.workspaceId)),
        })
      : [],
    tagIds.length > 0
      ? db.query.tag.findMany({
          where: and(inArray(tag.id, tagIds), eq(tag.workspaceId, viewer.workspaceId)),
        })
      : [],
  ]);
  const visible = new Map<string, boolean>();
  for (const p of projects) {
    visible.set(p.id, can(viewer.actor, "project.view", await projectResource(db, viewer, p.id)));
  }
  const taskGroups = await groupsOfTasks(
    db,
    tasks.map((t) => t.id),
  );

  return rows.map((r) => {
    const p = r.projectId ? projects.find((x) => x.id === r.projectId) : undefined;
    const t = r.taskId ? tasks.find((x) => x.id === r.taskId) : undefined;
    const tagRows = r.tagIds.flatMap((id) => {
      const found = tags.find((x) => x.id === id);
      return found ? [found] : [];
    });
    const blocked =
      r.projectId && (!p || !visible.get(p.id))
        ? "This project is no longer visible to you."
        : t && !mayTrack(viewer, t, taskGroups)
          ? TASK_UNAVAILABLE_MESSAGE
          : trackingBlock({
              project: p ? { id: p.id, archived: p.archived } : null,
              task: t ? { projectId: t.projectId, status: t.status } : null,
              tags: tagRows.map((x) => ({ name: x.name, archived: x.archived })),
            });
    return {
      id: r.id,
      description: r.description,
      projectId: p ? p.id : null,
      project: p
        ? { id: p.id, name: p.name, color: p.color, clientName: p.client?.name ?? null }
        : null,
      taskId: t ? t.id : null,
      task: t ? { id: t.id, name: t.name } : null,
      tags: tagRows.map((x) => ({ id: x.id, name: x.name, color: x.color })),
      tagIds: tagRows.map((x) => x.id),
      billable: r.billable,
      blocked,
    };
  });
}

/** Invariant 3: the details must be the viewer's workspace's, and visible to them. */
async function assertPinnable(db: Executor, viewer: Viewer, details: Details): Promise<void> {
  if (details.projectId) {
    let visible = false;
    try {
      const resource = await projectResource(db, viewer, details.projectId);
      visible = can(viewer.actor, "project.view", resource);
    } catch (error) {
      if (!(error instanceof WorkspaceAccessError)) throw error;
    }
    if (!visible) throw new CatalogError("NOT_FOUND", "Project not found.");
  }
  if (details.taskId) {
    const row = await db.query.task.findFirst({
      where: and(
        eq(task.id, details.taskId),
        eq(task.workspaceId, viewer.workspaceId),
        eq(task.projectId, details.projectId ?? ""),
      ),
      columns: { id: true, projectId: true },
    });
    if (!row) throw new CatalogError("NOT_FOUND", "Task not found.");
    // Decision 11: a favourite cannot pin a task outside the viewer's groups.
    if (!mayTrack(viewer, row, await groupsOfTasks(db, [row.id]))) {
      throw new CatalogError("INVALID", TASK_UNAVAILABLE_MESSAGE);
    }
  }
  const tagIds = [...new Set(details.tagIds)];
  if (tagIds.length > 0) {
    const rows = await db.query.tag.findMany({
      where: and(inArray(tag.id, tagIds), eq(tag.workspaceId, viewer.workspaceId)),
      columns: { id: true },
    });
    if (rows.length !== tagIds.length) throw new CatalogError("NOT_FOUND", "Tag not found.");
  }
}

/** Pins details; refused at the limit or when the same details are already pinned. */
export async function pinFavorite(
  db: Executor,
  viewer: Viewer,
  details: Details,
): Promise<FavoriteDTO> {
  const existing = await db
    .select()
    .from(favoriteEntry)
    .where(
      and(
        eq(favoriteEntry.workspaceId, viewer.workspaceId),
        eq(favoriteEntry.userId, viewer.userId),
      ),
    );
  if (existing.length >= MAX_FAVORITES) {
    throw new CatalogError("INVALID", `You can pin up to ${MAX_FAVORITES} favourites.`);
  }
  if (existing.some((r) => sameDetails(r, details))) {
    throw new CatalogError("CONFLICT", "Already pinned.");
  }
  await assertPinnable(db, viewer, details);
  const id = randomUUID();
  await db.insert(favoriteEntry).values({
    id,
    workspaceId: viewer.workspaceId,
    userId: viewer.userId,
    description: details.description.trim(),
    projectId: details.projectId,
    taskId: details.taskId,
    tagIds: [...new Set(details.tagIds)],
    billable: details.billable,
  });
  const pinned = (await listFavorites(db, viewer)).find((f) => f.id === id);
  if (!pinned) throw new Error("Favourite could not be pinned");
  return pinned;
}

export async function unpinFavorite(db: Executor, viewer: Viewer, id: string): Promise<void> {
  const rows = await db
    .delete(favoriteEntry)
    .where(
      and(
        eq(favoriteEntry.id, id),
        eq(favoriteEntry.workspaceId, viewer.workspaceId),
        eq(favoriteEntry.userId, viewer.userId),
      ),
    )
    .returning({ id: favoriteEntry.id });
  if (rows.length === 0) throw new CatalogError("NOT_FOUND", "Favourite not found.");
}
