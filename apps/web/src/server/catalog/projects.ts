import "server-only";

import { randomUUID } from "node:crypto";

import { pickColor, type ProjectInput } from "@timekeep/core";
import {
  and,
  asc,
  client,
  type Database,
  eq,
  project,
  projectFavorite,
  task,
} from "@timekeep/db";

import type { PickerProject } from "@/lib/tracker-types";

import { CatalogError, isUniqueViolation } from "./errors";
import { type Viewer, visibleProjectFilter } from "./viewer";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

const DUPLICATE_NAME = "A project with this name already exists for this client.";

function comparePicker(a: PickerProject, b: PickerProject): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  if (a.clientName !== b.clientName) {
    if (a.clientName === null) return 1;
    if (b.clientName === null) return -1;
    return a.clientName.localeCompare(b.clientName);
  }
  return a.name.localeCompare(b.name);
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
    .map(
      (r): PickerProject => ({
        id: r.id,
        name: r.name,
        color: r.color,
        clientId: r.clientId,
        clientName: r.client?.name ?? null,
        billable: r.billable,
        favorite: r.favorites.length > 0,
        tasks: r.tasks,
      }),
    )
    .sort(comparePicker);
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
  let clientName: string | null = null;
  if (clientId) {
    const found = await db.query.client.findFirst({
      where: and(eq(client.id, clientId), eq(client.workspaceId, viewer.workspaceId)),
      columns: { name: true },
    });
    if (!found) throw new CatalogError("INVALID", "Client not found.");
    clientName = found.name;
  }
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
  };
}
