import "server-only";

import { randomUUID } from "node:crypto";

import {
  type HolidayImportInput,
  type HolidayInput,
  type HolidayRule,
  holidaysInRange,
} from "@timekeep/core";
import { datasetHolidays, planHolidayImport } from "@timekeep/core/holiday-import";
import {
  and,
  asc,
  type Database,
  type DbExecutor,
  eq,
  gte,
  holiday,
  holidayAssignee,
  inArray,
  lte,
  or,
} from "@timekeep/db";

import type { HolidayDTO, ImportCandidateDTO } from "@/lib/time-off-types";

import { WorkspaceAccessError } from "../access-error";
import { assertCan } from "../authz";
import { CatalogError, isUniqueViolation } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { assertPeopleAndGroups, assigneeDiff } from "./policies";

type HolidayRow = typeof holiday.$inferSelect;

/**
 * The workspace's holidays that can fall in `[from, to]`: one-off rows in the
 * range and yearly rows that started by then, with their assignees, as core
 * rules (`holidaysInRange` places the yearly ones).
 */
export async function holidayRules(
  db: DbExecutor,
  workspaceId: string,
  from: string,
  to: string,
): Promise<(HolidayRule & { row: HolidayRow })[]> {
  const rows = await db
    .select()
    .from(holiday)
    .where(
      and(
        eq(holiday.workspaceId, workspaceId),
        lte(holiday.date, to),
        or(eq(holiday.repeatsYearly, true), gte(holiday.date, from)),
      ),
    )
    .orderBy(asc(holiday.date), asc(holiday.name));
  const inRange = rows;
  const assignees = inRange.length
    ? await db
        .select({
          holidayId: holidayAssignee.holidayId,
          userId: holidayAssignee.userId,
          groupId: holidayAssignee.groupId,
        })
        .from(holidayAssignee)
        .where(
          inArray(
            holidayAssignee.holidayId,
            inRange.map((r) => r.id),
          ),
        )
    : [];
  return inRange.map((row) => {
    const mine = assignees.filter((a) => a.holidayId === row.id);
    return {
      id: row.id,
      date: row.date,
      name: row.name,
      repeatsYearly: row.repeatsYearly,
      userIds: mine.flatMap((a) => (a.userId ? [a.userId] : [])),
      groupIds: mine.flatMap((a) => (a.groupId ? [a.groupId] : [])),
      row,
    };
  });
}

/** Everyone in the workspace may read the holiday list: it is not private. */
export async function listHolidays(
  db: Database,
  viewer: Viewer,
  year: number,
): Promise<HolidayDTO[]> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rules = await holidayRules(db, viewer.workspaceId, from, to);
  return holidaysInRange(rules, from, to).map(({ dateKey, holiday: h }) => {
    const rule = rules.find((r) => r.id === h.id)!;
    return {
      id: h.id,
      date: h.date,
      occursOn: dateKey,
      name: h.name,
      repeatsYearly: h.repeatsYearly,
      source: rule.row.source,
      estimated: rule.row.estimated,
      userIds: [...h.userIds],
      groupIds: [...h.groupIds],
    };
  });
}

async function replaceHolidayAssignees(
  tx: DbExecutor,
  holidayId: string,
  want: { userIds: readonly string[]; groupIds: readonly string[] },
): Promise<void> {
  const t = holidayAssignee;
  const current = await tx
    .select({ id: t.id, userId: t.userId, groupId: t.groupId })
    .from(t)
    .where(eq(t.holidayId, holidayId));
  const { dropIds, add } = assigneeDiff(current, want);
  if (dropIds.length) await tx.delete(t).where(inArray(t.id, dropIds));
  if (add.length) {
    await tx.insert(t).values(add.map((a) => ({ id: randomUUID(), holidayId, ...a })));
  }
}

export async function saveHoliday(
  db: Database,
  viewer: Viewer,
  input: HolidayInput,
  id?: string,
): Promise<HolidayDTO> {
  assertCan(viewer.actor, "timeOff.manage", { kind: "none" });
  try {
    const holidayId = await db.transaction(async (tx) => {
      await assertPeopleAndGroups(tx, viewer.workspaceId, input.userIds, input.groupIds);
      const values = { date: input.date, name: input.name, repeatsYearly: input.repeatsYearly };
      let holidayId = id;
      if (holidayId) {
        const rows = await tx
          .update(holiday)
          .set(values)
          .where(and(eq(holiday.id, holidayId), eq(holiday.workspaceId, viewer.workspaceId)))
          .returning({ id: holiday.id });
        if (rows.length === 0) throw new WorkspaceAccessError(404, "Not found");
      } else {
        holidayId = randomUUID();
        await tx
          .insert(holiday)
          .values({ id: holidayId, workspaceId: viewer.workspaceId, ...values });
      }
      await replaceHolidayAssignees(tx, holidayId, input);
      return holidayId;
    });
    const year = Number(input.date.slice(0, 4));
    const dto = (await listHolidays(db, viewer, year)).find((h) => h.id === holidayId);
    if (!dto) throw new WorkspaceAccessError(404, "Not found");
    return dto;
  } catch (error) {
    if (isUniqueViolation(error, "holiday_workspace_date_name_uq")) {
      throw new CatalogError(
        "CONFLICT",
        `There is already a holiday called ${input.name} that day.`,
      );
    }
    throw error;
  }
}

export async function deleteHoliday(db: Database, viewer: Viewer, id: string): Promise<void> {
  assertCan(viewer.actor, "timeOff.manage", { kind: "none" });
  const rows = await db
    .delete(holiday)
    .where(and(eq(holiday.id, id), eq(holiday.workspaceId, viewer.workspaceId)))
    .returning({ id: holiday.id });
  if (rows.length === 0) throw new WorkspaceAccessError(404, "Not found");
}

/** Each holiday's date and name in `year`, as the import compares them. */
async function occurrences(db: DbExecutor, workspaceId: string, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rules = await holidayRules(db, workspaceId, from, to);
  return holidaysInRange(rules, from, to).map((o) => ({ date: o.dateKey, name: o.holiday.name }));
}

/** The reviewed list for the import dialog (Review Focus 5: a renamed day comes unticked). */
export async function previewHolidayImport(
  db: Database,
  viewer: Viewer,
  input: { country: string; region: string | null; year: number; includeOptional: boolean },
): Promise<ImportCandidateDTO[]> {
  assertCan(viewer.actor, "timeOff.manage", { kind: "none" });
  const rows = datasetHolidays(input.country, input.region, input.year, {
    includeOptional: input.includeOptional,
  });
  return planHolidayImport(rows, await occurrences(db, viewer.workspaceId, input.year));
}

/**
 * Adds the rows the admin kept. Exact (date, name) matches already in the
 * workspace (an earlier import, a row added since the review) are skipped.
 */
export async function importHolidays(
  db: Database,
  viewer: Viewer,
  input: HolidayImportInput,
): Promise<{ added: number }> {
  assertCan(viewer.actor, "timeOff.manage", { kind: "none" });
  const source = `imported: ${input.country}${input.region ? `-${input.region}` : ""} ${input.year}`;
  return db.transaction(async (tx) => {
    const existing = new Set(
      (await occurrences(tx, viewer.workspaceId, input.year)).map((o) => `${o.date}|${o.name}`),
    );
    const fresh = input.rows.filter((r) => {
      const key = `${r.date}|${r.name}`;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (fresh.length === 0) return { added: 0 };
    const inserted = await tx
      .insert(holiday)
      .values(
        fresh.map((r) => ({
          id: randomUUID(),
          workspaceId: viewer.workspaceId,
          date: r.date,
          name: r.name,
          source,
          country: input.country,
          estimated: r.estimated,
        })),
      )
      .onConflictDoNothing({ target: [holiday.workspaceId, holiday.date, holiday.name] })
      .returning({ id: holiday.id });
    return { added: inserted.length };
  });
}
