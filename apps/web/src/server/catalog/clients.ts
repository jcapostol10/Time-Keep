import "server-only";

import { randomUUID } from "node:crypto";

import { type ClientInput, entryCurrency } from "@timekeep/core";
import {
  and,
  asc,
  type Client,
  client,
  type Database,
  eq,
  ilike,
  isNotNull,
  project,
  sql,
  workspaceSettings,
} from "@timekeep/db";

import type { ClientDTO } from "@/lib/catalog-types";

import { projectsHaveRates, relabelProjectsCurrency } from "../rates";
import { CatalogError, isUniqueViolation } from "./errors";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

export type ClientStatusFilter = "active" | "archived" | "all";

const DUPLICATE_NAME = "A client with this name already exists.";

/** Projects per client, so the list and the delete rule share one count. */
async function projectCounts(db: Executor, workspaceId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ clientId: project.clientId, n: sql<number>`count(*)::int` })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNotNull(project.clientId)))
    .groupBy(project.clientId);
  return new Map(rows.flatMap((r) => (r.clientId ? [[r.clientId, r.n] as const] : [])));
}

function toDTO(row: Client, counts: Map<string, number>): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    email: row.email,
    notes: row.notes,
    currency: row.currency,
    archived: row.archived,
    projectCount: counts.get(row.id) ?? 0,
  };
}

/** Escapes LIKE wildcards so a search for "100%" means the characters. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function findOwned(db: Executor, workspaceId: string, id: string): Promise<Client> {
  const row = await db.query.client.findFirst({
    where: and(eq(client.id, id), eq(client.workspaceId, workspaceId)),
  });
  if (!row) throw new CatalogError("NOT_FOUND", "Client not found.");
  return row;
}

/** Clients of a workspace, alphabetical, with their project counts. */
export async function listClients(
  db: Executor,
  workspaceId: string,
  opts: { q?: string; status?: ClientStatusFilter },
): Promise<ClientDTO[]> {
  const status = opts.status ?? "active";
  const q = opts.q?.trim() ?? "";
  const rows = await db.query.client.findMany({
    where: and(
      eq(client.workspaceId, workspaceId),
      status === "all" ? undefined : eq(client.archived, status === "archived"),
      q ? ilike(client.name, likePattern(q)) : undefined,
    ),
    orderBy: asc(client.name),
  });
  const counts = await projectCounts(db, workspaceId);
  return rows.map((r) => toDTO(r, counts));
}

/** Every client, for selects: the project dialog hides archived ones unless already chosen. */
export async function listClientOptions(
  db: Executor,
  workspaceId: string,
): Promise<{ id: string; name: string; archived: boolean }[]> {
  return db
    .select({ id: client.id, name: client.name, archived: client.archived })
    .from(client)
    .where(eq(client.workspaceId, workspaceId))
    .orderBy(asc(client.name));
}

export async function createClient(
  db: Executor,
  workspaceId: string,
  input: ClientInput,
): Promise<ClientDTO> {
  const id = randomUUID();
  try {
    await db.insert(client).values({
      id,
      workspaceId,
      name: input.name.trim(),
      address: input.address,
      email: input.email,
      notes: input.notes,
      currency: input.currency,
    });
  } catch (error) {
    if (isUniqueViolation(error, "client_workspace_name_uq")) {
      throw new CatalogError("CONFLICT", DUPLICATE_NAME);
    }
    throw error;
  }
  return toDTO(await findOwned(db, workspaceId, id), new Map());
}

/** The workspace's currency, which a client without one of its own follows. */
export async function workspaceCurrency(
  db: Pick<Database, "select">,
  workspaceId: string,
): Promise<string> {
  const [row] = await db
    .select({ currency: workspaceSettings.currency })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row?.currency ?? "USD";
}

/**
 * A client's new currency relabels the rates of its projects and the saved
 * amounts of their entries, never converting them (Phase 6 design, decision
 * 8), so it asks first: without `confirmCurrencyChange` the change is refused
 * with CONFIRM when there is anything to relabel.
 */
export async function updateClient(
  db: Database,
  workspaceId: string,
  id: string,
  patch: Partial<ClientInput> & { archived?: boolean },
  options: { confirmCurrencyChange?: boolean } = {},
): Promise<ClientDTO> {
  const before = await findOwned(db, workspaceId, id);
  let relabel: { projectIds: string[]; to: string } | null = null;
  if (patch.currency !== undefined && patch.currency !== before.currency) {
    const base = await workspaceCurrency(db, workspaceId);
    const to = entryCurrency(patch.currency, base);
    if (to !== entryCurrency(before.currency, base)) {
      const projects = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.workspaceId, workspaceId), eq(project.clientId, id)));
      const projectIds = projects.map((p) => p.id);
      if (await projectsHaveRates(db, workspaceId, projectIds)) {
        if (!options.confirmCurrencyChange) {
          throw new CatalogError(
            "CONFIRM",
            `Rates and amounts on this client's projects will show in ${to}; they are not converted.`,
          );
        }
        relabel = { projectIds, to };
      }
    }
  }
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(client)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.address !== undefined ? { address: patch.address } : {}),
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
          ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        })
        .where(and(eq(client.id, id), eq(client.workspaceId, workspaceId)));
      if (relabel) await relabelProjectsCurrency(tx, workspaceId, relabel.projectIds, relabel.to);
    });
  } catch (error) {
    if (isUniqueViolation(error, "client_workspace_name_uq")) {
      throw new CatalogError("CONFLICT", DUPLICATE_NAME);
    }
    throw error;
  }
  return toDTO(await findOwned(db, workspaceId, id), await projectCounts(db, workspaceId));
}

/** Deletes a client that has no projects; otherwise IN_USE. */
export async function deleteClient(db: Executor, workspaceId: string, id: string): Promise<void> {
  await findOwned(db, workspaceId, id);
  const counts = await projectCounts(db, workspaceId);
  if ((counts.get(id) ?? 0) > 0) {
    throw new CatalogError("IN_USE", "Move or delete its projects first.");
  }
  await db.delete(client).where(and(eq(client.id, id), eq(client.workspaceId, workspaceId)));
}
