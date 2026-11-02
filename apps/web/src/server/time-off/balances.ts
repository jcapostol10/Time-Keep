import "server-only";

import { type Balance, can, policyBalance } from "@timekeep/core";
import {
  and,
  type Database,
  type DbExecutor,
  eq,
  gte,
  inArray,
  lte,
  sql,
  timeOffAdjustment,
  timeOffRequest,
} from "@timekeep/db";

import type { BalanceDTO } from "@/lib/time-off-types";

import { assertCan } from "../authz";
import type { Viewer } from "../catalog/viewer";
import { type PersonContext, peopleContext, workspaceZone, type WorkspaceZone } from "./people";
import { type AssignedPolicy, policiesFor } from "./policies";

interface Totals {
  approved: number;
  pending: number;
  adjustments: number;
}

const key = (userId: string, policyId: string) => `${userId}|${policyId}`;

/** Approved and pending requests (by start date) and adjustments in `year`, per person and policy. */
async function yearTotals(
  db: DbExecutor,
  workspaceId: string,
  userIds: readonly string[],
  year: number,
): Promise<Map<string, Totals>> {
  const out = new Map<string, Totals>();
  if (userIds.length === 0) return out;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const requests = await db
    .select({
      userId: timeOffRequest.userId,
      policyId: timeOffRequest.policyId,
      approved:
        sql<number>`coalesce(sum(${timeOffRequest.amountCenti}) filter (where ${timeOffRequest.status} = 'APPROVED'), 0)::bigint`.mapWith(
          Number,
        ),
      pending:
        sql<number>`coalesce(sum(${timeOffRequest.amountCenti}) filter (where ${timeOffRequest.status} = 'PENDING'), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(timeOffRequest)
    .where(
      and(
        eq(timeOffRequest.workspaceId, workspaceId),
        inArray(timeOffRequest.userId, [...userIds]),
        gte(timeOffRequest.startDate, from),
        lte(timeOffRequest.startDate, to),
      ),
    )
    .groupBy(sql.raw("1"), sql.raw("2"));
  const adjustments = await db
    .select({
      userId: timeOffAdjustment.userId,
      policyId: timeOffAdjustment.policyId,
      total: sql<number>`coalesce(sum(${timeOffAdjustment.amountCenti}), 0)::bigint`.mapWith(
        Number,
      ),
    })
    .from(timeOffAdjustment)
    .where(
      and(
        eq(timeOffAdjustment.workspaceId, workspaceId),
        inArray(timeOffAdjustment.userId, [...userIds]),
        gte(timeOffAdjustment.effectiveOn, from),
        lte(timeOffAdjustment.effectiveOn, to),
      ),
    )
    .groupBy(sql.raw("1"), sql.raw("2"));
  const at = (k: string) => {
    let t = out.get(k);
    if (!t) out.set(k, (t = { approved: 0, pending: 0, adjustments: 0 }));
    return t;
  };
  for (const r of requests) {
    const t = at(key(r.userId, r.policyId));
    t.approved = r.approved;
    t.pending = r.pending;
  }
  for (const a of adjustments) at(key(a.userId, a.policyId)).adjustments = a.total;
  return out;
}

export interface PersonBalance {
  assigned: AssignedPolicy;
  balance: Balance;
}

/** Each person's balance on each policy assigned to them, in `year` (ruling R1). */
export async function balancesFor(
  db: DbExecutor,
  zone: WorkspaceZone,
  people: readonly PersonContext[],
  year: number,
  today: string,
): Promise<Map<string, PersonBalance[]>> {
  // One after the other: `db` may be a transaction, whose one connection runs one query at a time.
  const assigned = await policiesFor(db, zone, people);
  const totals = await yearTotals(
    db,
    zone.id,
    people.map((p) => p.userId),
    year,
  );
  const out = new Map<string, PersonBalance[]>();
  for (const person of people) {
    out.set(
      person.userId,
      (assigned.get(person.userId) ?? []).map((a) => {
        const t = totals.get(key(person.userId, a.policy.id));
        return {
          assigned: a,
          balance: policyBalance({
            accrual: a.policy.accrual,
            allowanceCenti: a.policy.allowanceCenti,
            allowNegative: a.policy.allowNegative,
            year,
            startedOn: a.startedOn,
            today,
            adjustmentsCenti: t?.adjustments ?? 0,
            approvedCenti: t?.approved ?? 0,
            pendingCenti: t?.pending ?? 0,
          }),
        };
      }),
    );
  }
  return out;
}

/** Balances this year for one person (`userId`, 404 outside the scope) or everyone in scope. */
export async function listBalances(
  db: Database,
  viewer: Viewer,
  opts: { userId?: string; today: string },
): Promise<BalanceDTO[]> {
  if (opts.userId) {
    assertCan(viewer.actor, "timeOff.view", { kind: "person", userId: opts.userId });
  }
  const zone = await workspaceZone(db, viewer.workspaceId);
  const people = [
    ...(await peopleContext(db, zone, opts.userId ? [opts.userId] : undefined)).values(),
  ]
    .filter((p) => can(viewer.actor, "timeOff.view", { kind: "person", userId: p.userId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const year = Number(opts.today.slice(0, 4));
  const balances = await balancesFor(db, zone, people, year, opts.today);
  return people.flatMap((p) =>
    (balances.get(p.userId) ?? []).map((b) => ({
      userId: p.userId,
      userName: p.name,
      policyId: b.assigned.policy.id,
      policyName: b.assigned.policy.name,
      unit: b.assigned.policy.unit,
      year,
      balance: b.balance,
    })),
  );
}
