import "server-only";

import { randomUUID } from "node:crypto";

import { pickColor, type TagInput, type TagPatch } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  eq,
  isNull,
  sql,
  type Tag,
  tag,
  timeEntry,
  timeEntryTag,
} from "@timekeep/db";

import type { TagDTO } from "@/lib/catalog-types";
import type { EntryTag } from "@/lib/tracker-types";

import { CatalogError, isUniqueViolation } from "./errors";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

async function usageCounts(db: Executor, workspaceId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ tagId: timeEntryTag.tagId, n: sql<number>`count(*)::int` })
    .from(timeEntryTag)
    .innerJoin(timeEntry, eq(timeEntry.id, timeEntryTag.timeEntryId))
    .where(and(eq(timeEntry.workspaceId, workspaceId), isNull(timeEntry.deletedAt)))
    .groupBy(timeEntryTag.tagId);
  return new Map(rows.map((r) => [r.tagId, r.n]));
}

function toDTO(row: Tag, usage: Map<string, number>): TagDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archived,
    usageCount: usage.get(row.id) ?? 0,
  };
}

/** Tags of a workspace, alphabetical. Archived ones only when asked for (the tags page). */
export async function listTags(
  db: Executor,
  workspaceId: string,
  opts: { includeArchived: boolean },
): Promise<TagDTO[]> {
  const rows = await db.query.tag.findMany({
    where: and(
      eq(tag.workspaceId, workspaceId),
      opts.includeArchived ? undefined : eq(tag.archived, false),
    ),
    orderBy: asc(tag.name),
  });
  const usage = await usageCounts(db, workspaceId);
  return rows.map((r) => toDTO(r, usage));
}

/**
 * What the pickers need: active tags as id, name and colour. No usage counts,
 * which the tags page shows and which cost a group-by over every live entry.
 */
export async function listTagOptions(db: Executor, workspaceId: string): Promise<EntryTag[]> {
  return db.query.tag.findMany({
    where: and(eq(tag.workspaceId, workspaceId), eq(tag.archived, false)),
    orderBy: asc(tag.name),
    columns: { id: true, name: true, color: true },
  });
}

/**
 * Creates a tag by name (unique per workspace). The pickers' inline create
 * reuses an existing name, as the Phase 1 inline create did; the tags page
 * refuses it, since silently returning another tag would drop the chosen
 * colour and could hand back an archived tag the list hides.
 */
export async function createTag(
  db: Executor,
  workspaceId: string,
  input: TagInput,
  opts: { onDuplicate: "reuse" | "refuse" } = { onDuplicate: "reuse" },
): Promise<TagDTO> {
  const name = input.name.trim();
  const values = { id: randomUUID(), workspaceId, name, color: input.color ?? pickColor(name) };
  if (opts.onDuplicate === "refuse") {
    // One insert: a check-then-insert would let a concurrent create slip through as "created".
    try {
      await db.insert(tag).values(values);
    } catch (error) {
      if (!isUniqueViolation(error, "tag_workspace_name_uq")) throw error;
      const existing = await db.query.tag.findFirst({
        where: and(eq(tag.workspaceId, workspaceId), eq(tag.name, name)),
        columns: { archived: true },
      });
      throw new CatalogError(
        "CONFLICT",
        existing?.archived
          ? `${DUPLICATE_NAME} It is archived; show archived tags to restore it.`
          : DUPLICATE_NAME,
      );
    }
  } else {
    await db
      .insert(tag)
      .values(values)
      .onConflictDoNothing({ target: [tag.workspaceId, tag.name] });
  }
  const row = await db.query.tag.findFirst({
    where: and(eq(tag.workspaceId, workspaceId), eq(tag.name, name)),
  });
  if (!row) throw new Error("Tag could not be created");
  return toDTO(row, await usageCounts(db, workspaceId));
}

const DUPLICATE_NAME = "A tag with this name already exists.";

async function findOwned(db: Executor, workspaceId: string, id: string): Promise<Tag> {
  const row = await db.query.tag.findFirst({
    where: and(eq(tag.id, id), eq(tag.workspaceId, workspaceId)),
  });
  if (!row) throw new CatalogError("NOT_FOUND", "Tag not found.");
  return row;
}

/** Rename, recolour, archive or unarchive. Archived tags stay on entries but cannot be added. */
export async function updateTag(
  db: Executor,
  workspaceId: string,
  id: string,
  patch: TagPatch,
): Promise<TagDTO> {
  await findOwned(db, workspaceId, id);
  try {
    await db
      .update(tag)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      })
      .where(and(eq(tag.id, id), eq(tag.workspaceId, workspaceId)));
  } catch (error) {
    if (isUniqueViolation(error, "tag_workspace_name_uq")) {
      throw new CatalogError("CONFLICT", DUPLICATE_NAME);
    }
    throw error;
  }
  return toDTO(await findOwned(db, workspaceId, id), await usageCounts(db, workspaceId));
}

/** Deletes a tag; the link rows cascade, so entries simply lose it. */
export async function deleteTag(
  db: Executor,
  workspaceId: string,
  id: string,
): Promise<{ affectedEntries: number }> {
  await findOwned(db, workspaceId, id);
  const affectedEntries = (await usageCounts(db, workspaceId)).get(id) ?? 0;
  await db.delete(tag).where(and(eq(tag.id, id), eq(tag.workspaceId, workspaceId)));
  return { affectedEntries };
}
