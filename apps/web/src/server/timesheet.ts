import "server-only";

import { randomUUID } from "node:crypto";

import {
  addDaysInZone,
  shiftEntriesByDays,
  type TimesheetTemplateInput,
  daysBetweenInZone,
} from "@timekeep/core";
import { and, asc, type Database, eq, timesheetTemplate } from "@timekeep/db";

import type { TimesheetTemplateDTO } from "@/lib/catalog-types";
import type { TimeEntryDTO } from "@/lib/tracker-types";

import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";
import {
  createManualEntry,
  DetailUnusableError,
  type EntryScope,
  listEntriesInRange,
  TimeEntryError,
} from "./time-entries";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

function toDTO(row: typeof timesheetTemplate.$inferSelect): TimesheetTemplateDTO {
  return { id: row.id, name: row.name, rows: row.rows };
}

/** The viewer's templates in this workspace, by name. */
export async function listTemplates(db: Executor, viewer: Viewer): Promise<TimesheetTemplateDTO[]> {
  const rows = await db.query.timesheetTemplate.findMany({
    where: and(
      eq(timesheetTemplate.workspaceId, viewer.workspaceId),
      eq(timesheetTemplate.userId, viewer.userId),
    ),
    orderBy: asc(timesheetTemplate.name),
  });
  return rows.map(toDTO);
}

/** Saves a template; saving the same name again replaces its rows. */
export async function saveTemplate(
  db: Executor,
  viewer: Viewer,
  input: TimesheetTemplateInput,
): Promise<TimesheetTemplateDTO> {
  const name = input.name.trim();
  const [row] = await db
    .insert(timesheetTemplate)
    .values({
      id: randomUUID(),
      workspaceId: viewer.workspaceId,
      userId: viewer.userId,
      name,
      rows: input.rows,
    })
    .onConflictDoUpdate({
      target: [timesheetTemplate.workspaceId, timesheetTemplate.userId, timesheetTemplate.name],
      set: { rows: input.rows, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Template could not be saved");
  return toDTO(row);
}

export async function deleteTemplate(db: Executor, viewer: Viewer, id: string): Promise<void> {
  const rows = await db
    .delete(timesheetTemplate)
    .where(
      and(
        eq(timesheetTemplate.id, id),
        eq(timesheetTemplate.workspaceId, viewer.workspaceId),
        eq(timesheetTemplate.userId, viewer.userId),
      ),
    )
    .returning({ id: timesheetTemplate.id });
  if (rows.length === 0) throw new CatalogError("NOT_FOUND", "Template not found.");
}

export interface CopyWeekResult {
  created: TimeEntryDTO[];
  skipped: {
    /** Entries already in the target week with the same times and details. */
    duplicates: number;
    /** Entries whose details can no longer take time, with the reason. */
    unusable: Array<{ description: string; reason: string }>;
  };
}

/** What makes a copied entry the same as one already there. */
function copyKey(e: {
  start: string;
  end: string | null;
  projectId: string | null;
  taskId: string | null;
  description: string;
  type: string;
  billable: boolean;
}): string {
  return JSON.stringify([e.start, e.end, e.projectId, e.taskId, e.description, e.type, e.billable]);
}

/**
 * Copies every entry of the viewer's week starting at `fromWeekStart` to the
 * week starting at `toWeekStart`, keeping wall-clock times, details and type.
 * An entry already there with the same times and details is not copied again,
 * and an entry whose details can no longer take time (archived project, done
 * task, a field now required) is skipped with its reason; the rest are copied.
 * A period refusal (lock date, submitted period, a missing note) still fails
 * the whole copy: it is about the week, not one entry.
 */
export async function copyWeek(
  db: Database,
  scope: EntryScope,
  args: { fromWeekStart: Date; toWeekStart: Date; tz: string; note?: string },
): Promise<CopyWeekResult> {
  const days = daysBetweenInZone(args.fromWeekStart, args.toWeekStart, args.tz);
  if (days === 0) throw new TimeEntryError("INVALID", "Choose a different week.");
  const [source, target] = await Promise.all([
    listEntriesInRange(db, scope, {
      from: args.fromWeekStart,
      to: addDaysInZone(args.fromWeekStart, 7, args.tz),
    }),
    listEntriesInRange(db, scope, {
      from: args.toWeekStart,
      to: addDaysInZone(args.toWeekStart, 7, args.tz),
    }),
  ]);
  // Range reads return stopped entries only; narrow the type for the shift.
  const stopped = source.flatMap((e) => (e.end ? [{ ...e, end: e.end }] : []));
  const shifted = shiftEntriesByDays(stopped, days, args.tz);
  const present = new Set(target.map(copyKey));
  return db.transaction(async (tx) => {
    const result: CopyWeekResult = { created: [], skipped: { duplicates: 0, unusable: [] } };
    for (const e of shifted) {
      if (present.has(copyKey(e))) {
        result.skipped.duplicates += 1;
        continue;
      }
      try {
        // A savepoint, so a skipped entry leaves the copy's transaction usable.
        const created = await tx.transaction((sp) =>
          createManualEntry(sp, scope, {
            description: e.description,
            projectId: e.projectId,
            taskId: e.taskId,
            tagIds: e.tagIds,
            billable: e.billable,
            type: e.type,
            start: new Date(e.start),
            end: new Date(e.end),
            note: args.note,
          }),
        );
        result.created.push(created);
        present.add(copyKey(created));
      } catch (error) {
        const entryLevel =
          error instanceof DetailUnusableError ||
          (error instanceof TimeEntryError && error.field !== undefined);
        if (!entryLevel) throw error;
        result.skipped.unusable.push({ description: e.description, reason: error.message });
      }
    }
    return result;
  });
}
