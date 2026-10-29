import "server-only";

import { randomUUID } from "node:crypto";

import {
  bucketFor,
  can,
  type CopyProjectInput,
  DEFAULT_REPORT_QUERY,
  type DeleteProjectMode,
  pickColor,
  type ProjectInput,
  type ProjectListQuery,
  type ProjectPatch,
  type ViewerPrefs,
} from "@timekeep/core";

const UTC_PREFS: ViewerPrefs = {
  timezone: "UTC",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
import {
  and,
  asc,
  client,
  type Database,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  membership,
  or,
  project,
  projectFavorite,
  projectGroup,
  projectMember,
  rate,
  sql,
  task,
  taskAssignee,
  timeEntry,
  userGroup,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import type { ProjectDetail, ProjectListItem, ProjectStatus } from "@/lib/catalog-types";
import type { PickerProject } from "@/lib/tracker-types";

import { CatalogError, isUniqueViolation } from "./errors";
import { scopeFilter } from "../authz";
import { type Viewer, visibleProjectFilter } from "./viewer";
import { reassignProjectEntries, softDeleteProjectEntries } from "../time-entries";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

const DUPLICATE_NAME = "A project with this name already exists for this client.";
const NOT_FOUND = "Project not found.";

const detailRelations = {
  client: { columns: { name: true } },
  members: { columns: { userId: true } },
} as const;

type ProjectRow = typeof project.$inferSelect & {
  client: { name: string } | null;
  members: { userId: string }[];
};

/** Escapes LIKE wildcards so a search for "100%" means the characters. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The project, if it is in the viewer's workspace and visible to them. A
 * private project the viewer is not on is NOT_FOUND, like any other missing id.
 */
export async function requireVisibleProject(
  db: Executor,
  viewer: Viewer,
  projectId: string,
): Promise<ProjectRow> {
  const row = await db.query.project.findFirst({
    where: and(
      eq(project.id, projectId),
      eq(project.workspaceId, viewer.workspaceId),
      visibleProjectFilter(viewer),
    ),
    with: detailRelations,
  });
  if (!row) throw new CatalogError("NOT_FOUND", NOT_FOUND);
  return row;
}

/** Tracked seconds per project: everyone's for admins, the viewer's own otherwise. */
async function trackedByProject(db: Executor, viewer: Viewer): Promise<Map<string, number>> {
  const rows = await db
    .select({
      projectId: timeEntry.projectId,
      seconds: sql`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`.mapWith(Number),
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, viewer.workspaceId),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        isNotNull(timeEntry.projectId),
        // Admins see everyone's time, a manager their scope, a member their own.
        scopeFilter(viewer.actor),
      ),
    )
    .groupBy(timeEntry.projectId);
  return new Map(rows.flatMap((r) => (r.projectId ? [[r.projectId, r.seconds] as const] : [])));
}

async function favoriteIds(db: Executor, viewer: Viewer): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: projectFavorite.projectId })
    .from(projectFavorite)
    .innerJoin(project, eq(project.id, projectFavorite.projectId))
    .where(
      and(eq(projectFavorite.userId, viewer.userId), eq(project.workspaceId, viewer.workspaceId)),
    );
  return new Set(rows.map((r) => r.projectId));
}

function toListItem(row: ProjectRow, tracked: number, favorite: boolean): ProjectListItem {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    clientId: row.clientId,
    clientName: row.client?.name ?? null,
    billable: row.billable,
    visibility: row.visibility,
    archived: row.archived,
    isTemplate: row.isTemplate,
    note: row.note,
    favorite,
    trackedSeconds: tracked,
    memberCount: row.members.length,
  };
}

function toDetail(row: ProjectRow, tracked: number, favorite: boolean): ProjectDetail {
  return {
    ...toListItem(row, tracked, favorite),
    memberIds: row.members.map((m) => m.userId),
  };
}

function compareBy(sort: ProjectListQuery["sort"], dir: ProjectListQuery["dir"]) {
  const sign = dir === "asc" ? 1 : -1;
  return (a: ProjectListItem, b: ProjectListItem): number => {
    let cmp = 0;
    if (sort === "tracked") cmp = a.trackedSeconds - b.trackedSeconds;
    else if (sort === "client") {
      cmp = (a.clientName ?? "￿").localeCompare(b.clientName ?? "￿");
    }
    if (cmp === 0) cmp = a.name.localeCompare(b.name);
    return cmp * sign;
  };
}

function comparePicker(a: PickerProject, b: PickerProject): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  if (a.clientName !== b.clientName) {
    if (a.clientName === null) return 1;
    if (b.clientName === null) return -1;
    return a.clientName.localeCompare(b.clientName);
  }
  return a.name.localeCompare(b.name);
}

/** The projects list page: visible projects filtered, sorted and with tracked time. */
export async function listProjects(
  db: Executor,
  viewer: Viewer,
  q: Omit<ProjectListQuery, "kind"> & { kind?: ProjectListQuery["kind"] },
): Promise<ProjectListItem[]> {
  const filters: (SQL | undefined)[] = [
    eq(project.workspaceId, viewer.workspaceId),
    visibleProjectFilter(viewer),
  ];
  // Templates are listed apart (Phase 4b): the projects view never shows them.
  filters.push(eq(project.isTemplate, (q.kind ?? "projects") === "templates"));
  if (q.status !== "all") filters.push(eq(project.archived, q.status === "archived"));
  if (q.billing !== "all") filters.push(eq(project.billable, q.billing === "billable"));
  if (q.access !== "all") {
    filters.push(eq(project.visibility, q.access === "private" ? "PRIVATE" : "PUBLIC"));
  }
  if (q.clientId) filters.push(eq(project.clientId, q.clientId));
  if (q.q) {
    const pattern = likePattern(q.q);
    filters.push(
      or(
        ilike(project.name, pattern),
        sql`EXISTS (SELECT 1 FROM "client" c WHERE c."id" = ${project.clientId} AND c."name" ILIKE ${pattern})`,
      ),
    );
  }
  const rows = await db.query.project.findMany({ where: and(...filters), with: detailRelations });
  const [tracked, favorites] = await Promise.all([
    trackedByProject(db, viewer),
    favoriteIds(db, viewer),
  ]);
  return rows
    .map((r) => toListItem(r, tracked.get(r.id) ?? 0, favorites.has(r.id)))
    .sort(compareBy(q.sort, q.dir));
}

/**
 * Projects the viewer may track on: visible, not archived, with their active
 * tasks. Favourites first, then by client (none last), then by name.
 */
export async function listPickerProjects(db: Executor, viewer: Viewer): Promise<PickerProject[]> {
  const rows = await db.query.project.findMany({
    where: and(
      eq(project.workspaceId, viewer.workspaceId),
      eq(project.archived, false),
      eq(project.isTemplate, false),
      visibleProjectFilter(viewer),
    ),
    with: {
      client: { columns: { name: true } },
      tasks: {
        where: eq(task.status, "ACTIVE"),
        columns: { id: true, name: true },
        orderBy: asc(task.name),
      },
      favorites: { where: eq(projectFavorite.userId, viewer.userId), columns: { userId: true } },
    },
  });
  return rows
    .map((r): PickerProject => ({
      id: r.id,
      name: r.name,
      color: r.color,
      clientId: r.clientId,
      clientName: r.client?.name ?? null,
      billable: r.billable,
      favorite: r.favorites.length > 0,
      tasks: r.tasks,
      // Filled by the task-visibility read (Task 4 of the task-groups plan).
      canCreateTask: false,
    }))
    .sort(comparePicker);
}

/** Templates the viewer may see, for "Start from template". */
export async function listTemplates(
  db: Executor,
  viewer: Viewer,
): Promise<{ id: string; name: string }[]> {
  const rows = await db.query.project.findMany({
    where: and(
      eq(project.workspaceId, viewer.workspaceId),
      eq(project.isTemplate, true),
      visibleProjectFilter(viewer),
    ),
    columns: { id: true, name: true },
    orderBy: asc(project.name),
  });
  return rows;
}

/**
 * A copy of a project (Phase 4b templates): its settings, unless the caller
 * overrides them, its active tasks with their assignees, its members with
 * their manager flag, its groups, and the rates in force now at the project,
 * project-member and task levels, written as new rows effective from now.
 * The source must be visible to the caller; the caller's `project.create`
 * right is the action's check.
 */
export async function copyProject(
  db: Database,
  viewer: Viewer,
  sourceId: string,
  opts: Omit<CopyProjectInput, "sourceId">,
  now: Date = new Date(),
): Promise<{ id: string; name: string }> {
  const source = await requireVisibleProject(db, viewer, sourceId);
  const name = opts.name.trim();
  const clientId = opts.clientId ?? null;
  if (clientId) await requireClientName(db, viewer.workspaceId, clientId);
  const tasks = await db
    .select()
    .from(task)
    .where(and(eq(task.projectId, sourceId), eq(task.status, "ACTIVE")));
  const taskIds = tasks.map((t) => t.id);
  const [assignees, members, groups, rateRows] = await Promise.all([
    taskIds.length > 0
      ? db.select().from(taskAssignee).where(inArray(taskAssignee.taskId, taskIds))
      : [],
    db.select().from(projectMember).where(eq(projectMember.projectId, sourceId)),
    db.select().from(projectGroup).where(eq(projectGroup.projectId, sourceId)),
    db
      .select()
      .from(rate)
      .where(
        and(
          eq(rate.workspaceId, viewer.workspaceId),
          eq(rate.kind, "billable"),
          eq(rate.projectId, sourceId),
          sql`${rate.effectiveFrom} <= ${now}`,
        ),
      ),
  ]);
  // The row in force per level and target: the latest effective one; a null amount means none.
  const inForce = new Map<string, (typeof rateRows)[number]>();
  for (const r of rateRows) {
    const key = `${r.level}|${r.userId ?? ""}|${r.taskId ?? ""}`;
    const seen = inForce.get(key);
    if (!seen || seen.effectiveFrom < r.effectiveFrom) inForce.set(key, r);
  }
  const id = randomUUID();
  const taskMap = new Map(taskIds.map((old) => [old, randomUUID()]));
  await db.transaction(async (tx) => {
    try {
      await tx.insert(project).values({
        id,
        workspaceId: viewer.workspaceId,
        name,
        color: opts.color ?? source.color,
        clientId,
        billable: opts.billable ?? source.billable,
        visibility: opts.visibility ?? source.visibility,
        note: opts.note ?? source.note,
        isTemplate: opts.isTemplate,
      });
    } catch (error) {
      if (isUniqueViolation(error, "project_workspace_client_name_uq")) {
        throw new CatalogError("CONFLICT", DUPLICATE_NAME);
      }
      throw error;
    }
    if (tasks.length > 0) {
      await tx.insert(task).values(
        tasks.map((t) => ({
          id: taskMap.get(t.id)!,
          workspaceId: viewer.workspaceId,
          projectId: id,
          name: t.name,
          status: "ACTIVE" as const,
        })),
      );
    }
    if (assignees.length > 0) {
      await tx
        .insert(taskAssignee)
        .values(assignees.map((a) => ({ taskId: taskMap.get(a.taskId)!, userId: a.userId })));
    }
    if (members.length > 0) {
      await tx.insert(projectMember).values(
        members.map((m) => ({ projectId: id, userId: m.userId, isManager: m.isManager })),
      );
    }
    if (groups.length > 0) {
      await tx.insert(projectGroup).values(groups.map((g) => ({ projectId: id, groupId: g.groupId })));
    }
    const copied = [...inForce.values()].filter(
      (r) => r.amountMinor !== null && (r.taskId === null || taskMap.has(r.taskId)),
    );
    if (copied.length > 0) {
      await tx.insert(rate).values(
        copied.map((r) => ({
          id: randomUUID(),
          workspaceId: viewer.workspaceId,
          kind: r.kind,
          level: r.level,
          userId: r.userId,
          projectId: id,
          taskId: r.taskId ? (taskMap.get(r.taskId) ?? null) : null,
          amountMinor: r.amountMinor,
          currency: r.currency,
          effectiveFrom: now,
          createdBy: viewer.userId,
        })),
      );
    }
  });
  return { id, name };
}

export async function getProject(
  db: Executor,
  viewer: Viewer,
  projectId: string,
): Promise<ProjectDetail> {
  const row = await requireVisibleProject(db, viewer, projectId);
  const [tracked, favorites] = await Promise.all([
    trackedByProject(db, viewer),
    favoriteIds(db, viewer),
  ]);
  return toDetail(row, tracked.get(row.id) ?? 0, favorites.has(row.id));
}

async function requireClientName(
  db: Executor,
  workspaceId: string,
  clientId: string,
): Promise<string> {
  const found = await db.query.client.findFirst({
    where: and(eq(client.id, clientId), eq(client.workspaceId, workspaceId)),
    columns: { name: true },
  });
  if (!found) throw new CatalogError("INVALID", "Client not found.");
  return found.name;
}

/**
 * Creates a project. Only the name is required; the rest take the schema's
 * defaults (billable, public, no client). The caller checks the role.
 */
export async function createProject(
  db: Executor,
  viewer: Viewer,
  input: Partial<ProjectInput> & Pick<ProjectInput, "name">,
): Promise<PickerProject> {
  const name = input.name.trim();
  const clientId = input.clientId ?? null;
  const clientName = clientId ? await requireClientName(db, viewer.workspaceId, clientId) : null;
  const id = randomUUID();
  try {
    await db.insert(project).values({
      id,
      workspaceId: viewer.workspaceId,
      name,
      color: input.color ?? pickColor(name),
      clientId,
      billable: input.billable ?? true,
      visibility: input.visibility ?? "PUBLIC",
      note: input.note ?? "",
    });
  } catch (error) {
    if (isUniqueViolation(error, "project_workspace_client_name_uq")) {
      throw new CatalogError("CONFLICT", DUPLICATE_NAME);
    }
    throw error;
  }
  const row = await db.query.project.findFirst({ where: eq(project.id, id) });
  if (!row) throw new Error("Project could not be created");
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    clientId: row.clientId,
    clientName,
    billable: row.billable,
    favorite: false,
    tasks: [],
    canCreateTask: can(viewer.actor, "task.create", { kind: "task", projectId: row.id }),
  };
}

export async function updateProject(
  db: Executor,
  viewer: Viewer,
  projectId: string,
  patch: ProjectPatch,
): Promise<ProjectDetail> {
  await requireVisibleProject(db, viewer, projectId);
  if (patch.clientId) await requireClientName(db, viewer.workspaceId, patch.clientId);
  try {
    await db
      .update(project)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.billable !== undefined ? { billable: patch.billable } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        ...(patch.isTemplate !== undefined ? { isTemplate: patch.isTemplate } : {}),
      })
      .where(eq(project.id, projectId));
  } catch (error) {
    if (isUniqueViolation(error, "project_workspace_client_name_uq")) {
      throw new CatalogError("CONFLICT", DUPLICATE_NAME);
    }
    throw error;
  }
  return getProject(db, viewer, projectId);
}

/** Archives or unarchives the given visible projects; returns how many changed. */
export async function setProjectsArchived(
  db: Executor,
  viewer: Viewer,
  ids: string[],
  archived: boolean,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(project)
    .set({ archived })
    .where(
      and(
        inArray(project.id, ids),
        eq(project.workspaceId, viewer.workspaceId),
        visibleProjectFilter(viewer),
      ),
    )
    .returning({ id: project.id });
  return rows.length;
}

/**
 * Deletes a project after moving its entries to another project (or none)
 * or soft-deleting them, in one transaction. The target must be visible and
 * not archived.
 */
export async function deleteProject(
  db: Database,
  viewer: Viewer,
  projectId: string,
  mode: DeleteProjectMode,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireVisibleProject(tx, viewer, projectId);
    if (mode.mode === "reassign") {
      if (mode.projectId) {
        if (mode.projectId === projectId) {
          throw new CatalogError("INVALID", "Choose a different project.");
        }
        const target = await tx.query.project.findFirst({
          where: and(
            eq(project.id, mode.projectId),
            eq(project.workspaceId, viewer.workspaceId),
            visibleProjectFilter(viewer),
          ),
          columns: { archived: true },
        });
        if (!target) throw new CatalogError("INVALID", "Target project not found.");
        if (target.archived) throw new CatalogError("INVALID", "Target project is archived.");
      }
      await reassignProjectEntries(tx, viewer.workspaceId, projectId, mode.projectId);
    } else {
      await softDeleteProjectEntries(tx, viewer.workspaceId, projectId);
    }
    await tx.delete(project).where(eq(project.id, projectId));
  });
}

/** Replaces the members of a (private) project; each must be an active workspace member. */
export async function setProjectMembers(
  db: Database,
  viewer: Viewer,
  projectId: string,
  userIds: string[],
): Promise<void> {
  await requireVisibleProject(db, viewer, projectId);
  const unique = [...new Set(userIds)];
  if (unique.length > 0) {
    const rows = await db
      .select({ userId: membership.userId })
      .from(membership)
      .where(
        and(
          eq(membership.workspaceId, viewer.workspaceId),
          inArray(membership.userId, unique),
          eq(membership.status, "ACTIVE"),
        ),
      );
    if (rows.length !== unique.length) {
      throw new CatalogError("INVALID", "Only workspace members can be added.");
    }
  }
  // The project's managers stay on it: their place is part of their scope (team.ts).
  await db.transaction(async (tx) => {
    await tx
      .delete(projectMember)
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.isManager, false)));
    if (unique.length > 0) {
      await tx
        .insert(projectMember)
        .values(unique.map((userId) => ({ projectId, userId })))
        .onConflictDoNothing();
    }
  });
}

/** Groups whose members may see and track on a PRIVATE project, replaced as a whole. */
export async function setProjectGroups(
  db: Database,
  viewer: Viewer,
  projectId: string,
  groupIds: string[],
): Promise<void> {
  await requireVisibleProject(db, viewer, projectId);
  const unique = [...new Set(groupIds)];
  if (unique.length > 0) {
    const rows = await db
      .select({ id: userGroup.id })
      .from(userGroup)
      .where(and(eq(userGroup.workspaceId, viewer.workspaceId), inArray(userGroup.id, unique)));
    if (rows.length !== unique.length) throw new CatalogError("INVALID", "Group not found.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(projectGroup).where(eq(projectGroup.projectId, projectId));
    if (unique.length > 0) {
      await tx.insert(projectGroup).values(unique.map((groupId) => ({ projectId, groupId })));
    }
  });
}

export async function setFavorite(
  db: Executor,
  viewer: Viewer,
  projectId: string,
  favorite: boolean,
): Promise<void> {
  await requireVisibleProject(db, viewer, projectId);
  if (favorite) {
    await db
      .insert(projectFavorite)
      .values({ projectId, userId: viewer.userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(projectFavorite)
      .where(
        and(eq(projectFavorite.projectId, projectId), eq(projectFavorite.userId, viewer.userId)),
      );
  }
}

/** Tracked time on a project by task and by member, for entries starting in `[from, to)`. */
export async function getProjectStatus(
  db: Executor,
  viewer: Viewer,
  projectId: string,
  range: { from: Date; to: Date },
  // Task and person groups do not depend on a zone; the weekly bars do.
  prefs: ViewerPrefs = UTC_PREFS,
): Promise<ProjectStatus> {
  await requireVisibleProject(db, viewer, projectId);
  // Through the report engine, so the tab and the reports cannot disagree. Lazy:
  // reports.ts imports this module.
  const { summaryReport } = await import("../reports");
  // Past a month the tab adds a bar per week (the engine's series, in the viewer's weeks).
  const weekly = bucketFor(range.from, range.to, prefs.timezone) !== "day";
  const query = {
    ...DEFAULT_REPORT_QUERY,
    preset: "custom" as const,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    projectIds: [projectId],
    bucket: "week" as const,
  };
  const [byTask, byUser] = await Promise.all([
    summaryReport(db, viewer, { ...query, groupBy: ["task"] }, prefs),
    summaryReport(db, viewer, { ...query, groupBy: ["user"] }, prefs),
  ]);
  const totals = byTask.totals;
  return {
    weeks: weekly
      ? byTask.series.map((p) => ({
          key: p.key,
          label: p.label,
          seconds: p.billableSeconds + p.nonBillableSeconds,
        }))
      : null,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    byTask: byTask.groups.map((g) => ({
      taskId: g.id,
      name: g.label,
      seconds: g.totals.durationSeconds,
      amountMinor: g.totals.amountMinor,
    })),
    byMember: byUser.groups.map((g) => ({
      userId: g.id ?? "",
      name: g.label,
      seconds: g.totals.durationSeconds,
      amountMinor: g.totals.amountMinor,
    })),
    money: byTask.money,
    amountMinor: totals.amountMinor,
    billableSeconds: totals.billableSeconds,
    nonBillableSeconds: totals.durationSeconds - totals.billableSeconds,
    totalSeconds: totals.durationSeconds,
  };
}
