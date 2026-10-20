import "server-only";

import { randomUUID } from "node:crypto";

import { addDaysInZone, shiftEntriesByDays, type TimesheetTemplateInput } from "@timekeep/core";
import { and, asc, type Database, eq, timesheetTemplate } from "@timekeep/db";

import type { TimesheetTemplateDTO } from "@/lib/catalog-types";
import type { TimeEntryDTO } from "@/lib/tracker-types";

import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";
import {
  createManualEntry,
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

/**
 * Copies every entry of the viewer's week starting at `fromWeekStart` to the
 * week starting at `toWeekStart`, keeping wall-clock times and details, in
 * one transaction: if any detail is no longer usable (archived project, done
 * task), nothing is copied.
 */
export async function copyWeek(
  db: Database,
  scope: EntryScope,
  args: { fromWeekStart: Date; toWeekStart: Date; tz: string },
): Promise<TimeEntryDTO[]> {
  const days = Math.round((args.toWeekStart.getTime() - args.fromWeekStart.getTime()) / 86_400_000);
  if (days === 0) throw new TimeEntryError("INVALID", "Choose a different week.");
  const source = await listEntriesInRange(db, scope, {
    from: args.fromWeekStart,
    to: addDaysInZone(args.fromWeekStart, 7, args.tz),
  });
  const shifted = shiftEntriesByDays(source, days, args.tz);
  return db.transaction(async (tx) => {
    const created: TimeEntryDTO[] = [];
    for (const e of shifted) {
      created.push(
        await createManualEntry(tx, scope, {
          description: e.description,
          projectId: e.projectId,
          taskId: e.taskId,
          tagIds: e.tagIds,
          billable: e.billable,
          start: new Date(e.start),
          end: new Date(e.end),
        }),
      );
    }
    return created;
  });
}
