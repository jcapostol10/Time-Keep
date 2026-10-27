import "server-only";

import { randomUUID } from "node:crypto";

import {
  currencyExponent,
  parseMoney,
  type RateApply,
  rateEffectiveFrom,
  type RateLevel,
} from "@timekeep/core";
import {
  and,
  type Database,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  membership,
  project,
  rate,
  task,
  timeEntry,
  user,
  workspaceSettings,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import { assertCan } from "./authz";
import { CatalogError } from "./catalog/errors";
import type { RateDTO } from "@/lib/rate-types";

import type { Viewer } from "./catalog/viewer";
import { requestRateRecalc } from "./rate-recalc";

export type { RateDTO };

/**
 * Billable rates per level, with history: a change adds a row effective
 * from a date (rows are never edited, except that a second change on the
 * same effective date replaces that date's row). Owners and admins set
 * them; entries are rated by `rates-sql.ts` in the entry service.
 */

export interface RateTargetInput {
  level: RateLevel;
  userId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
}

export interface SetRateInput extends RateTargetInput {
  /** As typed ("125.50"); empty or null = no rate at this level from the date. */
  amount: string | null;
  apply: RateApply;
  /** yyyy-MM-dd in the workspace timezone; required when apply is "from". */
  from?: string;
}

interface Target {
  userId: string | null;
  projectId: string | null;
  taskId: string | null;
}

/** The level's target columns, each checked to belong to the workspace. */
async function resolveTarget(db: Database, viewer: Viewer, t: RateTargetInput): Promise<Target> {
  const ws = viewer.workspaceId;
  const needUser = t.level === "member" || t.level === "project_member";
  const needProject = t.level === "project" || t.level === "project_member";
  const out: Target = { userId: null, projectId: null, taskId: null };
  if (needUser) {
    if (!t.userId) throw new CatalogError("INVALID", "Choose a person.");
    const m = await db.query.membership.findFirst({
      where: and(eq(membership.workspaceId, ws), eq(membership.userId, t.userId)),
      columns: { id: true },
    });
    if (!m) throw new CatalogError("NOT_FOUND", "Member not found.");
    out.userId = t.userId;
  }
  if (needProject) {
    if (!t.projectId) throw new CatalogError("INVALID", "Choose a project.");
    const p = await db.query.project.findFirst({
      where: and(eq(project.id, t.projectId), eq(project.workspaceId, ws)),
      columns: { id: true },
    });
    if (!p) throw new CatalogError("NOT_FOUND", "Project not found.");
    out.projectId = t.projectId;
  }
  if (t.level === "task") {
    if (!t.taskId) throw new CatalogError("INVALID", "Choose a task.");
    const row = await db.query.task.findFirst({
      where: and(eq(task.id, t.taskId), eq(task.workspaceId, ws)),
      columns: { id: true, projectId: true },
    });
    if (!row) throw new CatalogError("NOT_FOUND", "Task not found.");
    out.taskId = row.id;
    out.projectId = row.projectId;
  }
  return out;
}

function targetWhere(viewer: Viewer, level: RateLevel, t: Target): SQL {
  const col = (
    column: typeof rate.userId | typeof rate.projectId | typeof rate.taskId,
    value: string | null,
  ) => (value === null ? isNull(column) : eq(column, value));
  return and(
    eq(rate.workspaceId, viewer.workspaceId),
    eq(rate.kind, "billable"),
    eq(rate.level, level),
    col(rate.userId, t.userId),
    col(rate.projectId, t.projectId),
    col(rate.taskId, t.taskId),
  )!;
}

async function settingsOf(db: Database, workspaceId: string) {
  const row = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, workspaceId),
    columns: { currency: true, timezone: true },
  });
  return row ?? { currency: "USD", timezone: "UTC" };
}

/** Adds a rate row; "Entries from a date" and "All entries" queue the recalculation job. */
export async function setRate(
  db: Database,
  viewer: Viewer,
  input: SetRateInput,
  now: Date = new Date(),
): Promise<{ rate: RateDTO; jobId: string | null }> {
  assertCan(viewer.actor, "rate.set", { kind: "none" });
  const target = await resolveTarget(db, viewer, input);
  const { currency, timezone } = await settingsOf(db, viewer.workspaceId);

  const typed = input.amount?.trim() ?? "";
  let amountMinor: number | null = null;
  if (typed !== "") {
    amountMinor = parseMoney(typed, currency);
    if (amountMinor === null) {
      const decimals = currencyExponent(currency);
      throw new CatalogError(
        "INVALID",
        `Enter an hourly amount in ${currency} with at most ${decimals} decimal${decimals === 1 ? "" : "s"}.`,
      );
    }
  }
  if (input.apply === "from" && !input.from) {
    throw new CatalogError("INVALID", "Choose the date the rate applies from.");
  }
  const effectiveFrom = rateEffectiveFrom(input.apply, { date: input.from, timezone, now });

  const id = randomUUID();
  const [row] = await db.transaction(async (tx) => {
    // From its date on, this rate replaces whatever the level said: a later row
    // would otherwise keep winning for the entries after it.
    await tx
      .delete(rate)
      .where(and(targetWhere(viewer, input.level, target), gt(rate.effectiveFrom, effectiveFrom)));
    return tx
      .insert(rate)
      .values({
        id,
        workspaceId: viewer.workspaceId,
        kind: "billable",
        level: input.level,
        ...target,
        amountMinor,
        currency,
        effectiveFrom,
        createdBy: viewer.userId,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          rate.workspaceId,
          rate.kind,
          rate.level,
          rate.userId,
          rate.projectId,
          rate.taskId,
          rate.effectiveFrom,
        ],
        set: { amountMinor, currency, createdBy: viewer.userId, createdAt: now },
      })
      .returning();
  });
  if (!row) throw new Error("rate insert returned nothing");

  const jobId =
    input.apply === "new"
      ? null
      : (await requestRateRecalc(db, viewer.workspaceId, viewer.userId, effectiveFrom)).jobId;
  return {
    rate: {
      id: row.id,
      level: row.level,
      amountMinor: row.amountMinor,
      currency: row.currency,
      effectiveFrom: row.effectiveFrom.toISOString(),
      createdByName: null,
      createdAt: row.createdAt.toISOString(),
    },
    jobId,
  };
}

/** Every row for one level and target, newest first. */
export async function rateHistory(
  db: Database,
  viewer: Viewer,
  input: RateTargetInput,
): Promise<RateDTO[]> {
  assertCan(viewer.actor, "rate.view", { kind: "none" });
  const target = await resolveTarget(db, viewer, input);
  const rows = await db
    .select({ rate, createdByName: user.name })
    .from(rate)
    .leftJoin(user, eq(user.id, rate.createdBy))
    .where(targetWhere(viewer, input.level, target))
    .orderBy(desc(rate.effectiveFrom));
  return rows.map(({ rate: r, createdByName }) => ({
    id: r.id,
    level: r.level,
    amountMinor: r.amountMinor,
    currency: r.currency,
    effectiveFrom: r.effectiveFrom.toISOString(),
    createdByName: createdByName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The row in force now for one level and target (null amount = none at this level). */
export async function currentRate(
  db: Database,
  viewer: Viewer,
  input: RateTargetInput,
  now: Date = new Date(),
): Promise<RateDTO | null> {
  const history = await rateHistory(db, viewer, input);
  return history.find((h) => new Date(h.effectiveFrom) <= now) ?? null;
}

/** Whether a currency change has anything to relabel. */
export async function workspaceHasRates(db: Pick<Database, "select">, workspaceId: string) {
  const [row] = await db
    .select({ id: rate.id })
    .from(rate)
    .where(eq(rate.workspaceId, workspaceId))
    .limit(1);
  return Boolean(row);
}

/**
 * One currency per workspace until Phase 6 (decision 4): a new currency
 * relabels every rate and rated entry, without converting any amount.
 */
export async function relabelWorkspaceCurrency(
  tx: Pick<Database, "update">,
  workspaceId: string,
  currency: string,
): Promise<void> {
  await tx.update(rate).set({ currency }).where(eq(rate.workspaceId, workspaceId));
  await tx
    .update(timeEntry)
    .set({ rateCurrency: currency })
    .where(and(eq(timeEntry.workspaceId, workspaceId), isNotNull(timeEntry.rateCurrency)));
}

/**
 * The amount in force now at one level for every target of it, keyed by
 * person (member, project_member) or task. A target missing from the map has
 * no row; a null value means its latest row says "no rate".
 */
export async function currentRatesAt(
  db: Database,
  viewer: Viewer,
  level: "member" | "project_member" | "task",
  options: { projectId?: string; now?: Date } = {},
): Promise<Map<string, number | null>> {
  assertCan(viewer.actor, "rate.view", { kind: "none" });
  const key = level === "task" ? rate.taskId : rate.userId;
  const rows = await db
    .selectDistinctOn([key], { key, amountMinor: rate.amountMinor })
    .from(rate)
    .where(
      and(
        eq(rate.workspaceId, viewer.workspaceId),
        eq(rate.kind, "billable"),
        eq(rate.level, level),
        options.projectId ? eq(rate.projectId, options.projectId) : undefined,
        lte(rate.effectiveFrom, options.now ?? new Date()),
      ),
    )
    .orderBy(key, desc(rate.effectiveFrom));
  return new Map(rows.flatMap((r) => (r.key ? [[r.key, r.amountMinor] as const] : [])));
}
