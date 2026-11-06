import "server-only";

import { randomUUID } from "node:crypto";

import {
  COST_LEVELS,
  currencyExponent,
  parseMoney,
  type RateApply,
  rateEffectiveFrom,
  type RateKind,
  type RateLevel,
} from "@timekeep/core";
import {
  and,
  client,
  type Database,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  membership,
  or,
  project,
  rate,
  sql,
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
 * Rates per level, with history: a change adds a row effective from a date
 * (rows are never edited, except that a second change on the same effective
 * date replaces that date's row). Owners and admins set them; entries are
 * rated by `rates-sql.ts` in the entry service.
 *
 * Two kinds (Phase 6a). Billable rates, at five levels, are in the currency
 * of what they price: a project's, task's or project member's in the
 * project's currency (its client's, else the workspace's), a member's and the
 * workspace's in the workspace currency. Cost rates, per member or per
 * project member, are always in the workspace currency.
 */

export const COST_LEVEL_MESSAGE = "Cost rates are per member or per project member.";

export interface RateTargetInput {
  /** Billable when left out. */
  kind?: RateKind;
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
  if (t.kind === "cost" && !COST_LEVELS.some((level) => level === t.level)) {
    throw new CatalogError("INVALID", COST_LEVEL_MESSAGE);
  }
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

function targetWhere(viewer: Viewer, kind: RateKind, level: RateLevel, t: Target): SQL {
  const col = (
    column: typeof rate.userId | typeof rate.projectId | typeof rate.taskId,
    value: string | null,
  ) => (value === null ? isNull(column) : eq(column, value));
  return and(
    eq(rate.workspaceId, viewer.workspaceId),
    eq(rate.kind, kind),
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

/** The currency a project bills in: its client's, else the workspace's (core `entryCurrency`). */
export async function projectCurrency(
  db: Pick<Database, "select">,
  workspaceId: string,
  projectId: string,
): Promise<string> {
  const [row] = await db
    .select({
      currency: sql<string>`coalesce(${client.currency}, ${workspaceSettings.currency})`,
    })
    .from(project)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, project.workspaceId))
    .leftJoin(client, eq(client.id, project.clientId))
    .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)));
  if (!row) throw new CatalogError("NOT_FOUND", "Project not found.");
  return row.currency;
}

function toDTO(row: typeof rate.$inferSelect, createdByName: string | null): RateDTO {
  return {
    id: row.id,
    kind: row.kind,
    level: row.level,
    amountMinor: row.amountMinor,
    currency: row.currency,
    effectiveFrom: row.effectiveFrom.toISOString(),
    createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Adds a rate row; "Entries from a date" and "All entries" queue the recalculation job. */
export async function setRate(
  db: Database,
  viewer: Viewer,
  input: SetRateInput,
  now: Date = new Date(),
): Promise<{ rate: RateDTO; jobId: string | null }> {
  assertCan(viewer.actor, "rate.set", { kind: "none" });
  const kind = input.kind ?? "billable";
  const target = await resolveTarget(db, viewer, input);
  const settings = await settingsOf(db, viewer.workspaceId);
  const timezone = settings.timezone;
  // A rate is in the currency of what it prices; cost is what the company pays.
  const currency =
    kind === "billable" && target.projectId
      ? await projectCurrency(db, viewer.workspaceId, target.projectId)
      : settings.currency;

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
      .where(
        and(targetWhere(viewer, kind, input.level, target), gt(rate.effectiveFrom, effectiveFrom)),
      );
    return tx
      .insert(rate)
      .values({
        id,
        workspaceId: viewer.workspaceId,
        kind,
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
  return { rate: toDTO(row, null), jobId };
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
    .where(targetWhere(viewer, input.kind ?? "billable", input.level, target))
    .orderBy(desc(rate.effectiveFrom));
  return rows.map(({ rate: r, createdByName }) => toDTO(r, createdByName ?? null));
}

/**
 * The currency a rate at this target is in: a billable rate on a project (or
 * its task or member) the project's, anything else the workspace's.
 */
async function rateCurrencyFor(
  db: Database,
  workspaceId: string,
  kind: RateKind,
  projectId: string | null | undefined,
): Promise<string> {
  return kind === "billable" && projectId
    ? projectCurrency(db, workspaceId, projectId)
    : (await settingsOf(db, workspaceId)).currency;
}

/**
 * The row in force now for one level and target (null amount = none at this
 * level). As the rating SQL does, it reads only rows in the target's
 * currency: a row left in another one (a project copied or billed before
 * currencies mattered) rates nothing, so it is not the current rate.
 */
export async function currentRate(
  db: Database,
  viewer: Viewer,
  input: RateTargetInput,
  now: Date = new Date(),
): Promise<RateDTO | null> {
  const history = await rateHistory(db, viewer, input);
  if (history.length === 0) return null;
  const target = await resolveTarget(db, viewer, input);
  const currency = await rateCurrencyFor(
    db,
    viewer.workspaceId,
    input.kind ?? "billable",
    target.projectId,
  );
  return history.find((h) => h.currency === currency && new Date(h.effectiveFrom) <= now) ?? null;
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

/** The projects of a workspace whose client has a currency of its own. */
const projectsWithOwnCurrency = (workspaceId: string) =>
  sql`(select p."id" from "project" p
    join "client" c on c."id" = p."client_id"
    where p."workspace_id" = ${workspaceId} and c."currency" is not null)`;

/**
 * A new workspace currency relabels what took the old one, without converting
 * any amount (Phase 6 design, decision 8): every cost rate, member and
 * workspace rates, and the rates and rated entries of projects that follow the
 * workspace. A client with a currency of its own keeps it, the workspace's old
 * code included.
 */
export async function relabelWorkspaceCurrency(
  tx: Pick<Database, "update">,
  workspaceId: string,
  from: string,
  to: string,
): Promise<void> {
  if (from === to) return;
  const own = projectsWithOwnCurrency(workspaceId);
  await tx
    .update(rate)
    .set({ currency: to })
    .where(
      and(
        eq(rate.workspaceId, workspaceId),
        eq(rate.currency, from),
        or(eq(rate.kind, "cost"), isNull(rate.projectId), sql`${rate.projectId} not in ${own}`),
      ),
    );
  await tx
    .update(timeEntry)
    .set({ rateCurrency: to })
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        eq(timeEntry.rateCurrency, from),
        or(isNull(timeEntry.projectId), sql`${timeEntry.projectId} not in ${own}`),
      ),
    );
}

/** The levels a project's own rates sit at: what a relabel of the project moves. */
const PROJECT_RATE_LEVELS = ["task", "project_member", "project"] as const;

/** Whether the projects have billable rates of their own, or entries those rates rated. */
export async function projectsHaveRates(
  db: Pick<Database, "select">,
  workspaceId: string,
  projectIds: string[],
): Promise<boolean> {
  if (projectIds.length === 0) return false;
  const [row] = await db
    .select({ id: rate.id })
    .from(rate)
    .where(
      and(
        eq(rate.workspaceId, workspaceId),
        eq(rate.kind, "billable"),
        inArray(rate.projectId, projectIds),
      ),
    )
    .limit(1);
  if (row) return true;
  const [entry] = await db
    .select({ id: timeEntry.id })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        inArray(timeEntry.projectId, projectIds),
        inArray(timeEntry.rateSource, [...PROJECT_RATE_LEVELS]),
      ),
    )
    .limit(1);
  return Boolean(entry);
}

/**
 * The projects now bill in `to` (their client's currency changed, or a project
 * moved to another client): their own billable rates, and the amounts those
 * rates produced, take the new code, unconverted. Cost stays the workspace's.
 *
 * Time rated by a member or workspace rate is left as it is: that amount is
 * in the workspace currency, and relabelling it would read ₱2,500 as $2,500.
 * It keeps its number and its currency until rates are applied to past
 * entries, when it is rated by the project's own rate or not at all.
 */
export async function relabelProjectsCurrency(
  tx: Pick<Database, "update">,
  workspaceId: string,
  projectIds: string[],
  to: string,
): Promise<void> {
  if (projectIds.length === 0) return;
  await tx
    .update(rate)
    .set({ currency: to })
    .where(
      and(
        eq(rate.workspaceId, workspaceId),
        eq(rate.kind, "billable"),
        inArray(rate.projectId, projectIds),
      ),
    );
  await tx
    .update(timeEntry)
    .set({ rateCurrency: to })
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        inArray(timeEntry.projectId, projectIds),
        inArray(timeEntry.rateSource, [...PROJECT_RATE_LEVELS]),
      ),
    );
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
  options: { projectId?: string; now?: Date; kind?: RateKind } = {},
): Promise<Map<string, number | null>> {
  if (options.kind === "cost" && level === "task") {
    throw new CatalogError("INVALID", COST_LEVEL_MESSAGE);
  }
  assertCan(viewer.actor, "rate.view", { kind: "none" });
  const kind = options.kind ?? "billable";
  // Only rows in the target's currency are in force (see `currentRate`).
  const currency =
    level === "member" || options.projectId
      ? await rateCurrencyFor(db, viewer.workspaceId, kind, options.projectId)
      : null;
  const key = level === "task" ? rate.taskId : rate.userId;
  const rows = await db
    .selectDistinctOn([key], { key, amountMinor: rate.amountMinor })
    .from(rate)
    .where(
      and(
        eq(rate.workspaceId, viewer.workspaceId),
        eq(rate.kind, kind),
        eq(rate.level, level),
        currency ? eq(rate.currency, currency) : undefined,
        options.projectId ? eq(rate.projectId, options.projectId) : undefined,
        lte(rate.effectiveFrom, options.now ?? new Date()),
      ),
    )
    .orderBy(key, desc(rate.effectiveFrom));
  return new Map(rows.flatMap((r) => (r.key ? [[r.key, r.amountMinor] as const] : [])));
}
