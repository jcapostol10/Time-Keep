import "server-only";

import { randomUUID } from "node:crypto";

import {
  can,
  countRequestCenti,
  formatTimeOffDates,
  holidayApplies,
  holidayKeysFor,
  holidaysInRange,
  localDateKey,
  requestMinutes,
  type Resource,
  type ReviewTimeOffInput,
  timeOffMinutesByDay,
  type TimeOffRequestInput,
  type TimeOffSpan,
  type TimeOffStatus,
  wouldGoNegative,
} from "@timekeep/core";
import {
  and,
  type Database,
  type DbExecutor,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  or,
  timeOffPolicy,
  timeOffRequest,
  user,
} from "@timekeep/db";
import { alias } from "drizzle-orm/pg-core";

import type {
  TimeOffDayDTO,
  TimeOffPreviewDTO,
  TimeOffRangeDTO,
  TimeOffRequestDTO,
  TimeOffTab,
} from "@/lib/time-off-types";

import { WorkspaceAccessError } from "../access-error";
import { approversFor } from "../approvers";
import { assertCan } from "../authz";
import { CatalogError } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { env } from "../env";
import { enqueueEmail } from "../outbox";
import { timerLock } from "../person-lock";
import { balancesFor } from "./balances";
import { holidayRules } from "./holidays";
import { type PersonContext, personContext, workspaceZone, type WorkspaceZone } from "./people";
import { policiesFor } from "./policies";
import { timeOffDecisionEmail, timeOffRequestedEmail } from "./time-off-emails";

/**
 * Time off requests (Phase 5b, decisions 9, 10 and 12). Time off is never a
 * time entry. A request is counted when it is made (working days less the
 * person's holidays); review follows the approvers setting with no projects
 * (ruling R3). Emails go through the outbox in the same transaction; callers
 * drain it after the response.
 */

const decider = alias(user, "time_off_decider");

const columns = {
  id: timeOffRequest.id,
  userId: timeOffRequest.userId,
  userName: user.name,
  policyId: timeOffRequest.policyId,
  policyName: timeOffPolicy.name,
  unit: timeOffPolicy.unit,
  start: timeOffRequest.startDate,
  end: timeOffRequest.endDate,
  halfDay: timeOffRequest.halfDay,
  minutes: timeOffRequest.minutes,
  amountCenti: timeOffRequest.amountCenti,
  note: timeOffRequest.note,
  status: timeOffRequest.status,
  decidedByName: decider.name,
  decidedAt: timeOffRequest.decidedAt,
  decisionNote: timeOffRequest.decisionNote,
};

function selectRequests(db: DbExecutor) {
  return db
    .select(columns)
    .from(timeOffRequest)
    .innerJoin(user, eq(user.id, timeOffRequest.userId))
    .innerJoin(timeOffPolicy, eq(timeOffPolicy.id, timeOffRequest.policyId))
    .leftJoin(decider, eq(decider.id, timeOffRequest.decidedBy));
}

type Row = Awaited<ReturnType<typeof selectRequests>>[number];

const reviewResource = (userId: string): Resource => ({ kind: "approval", userId, projectIds: [] });

function toDTO(r: Row, viewer: Viewer): TimeOffRequestDTO {
  return {
    ...r,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    canReview:
      (r.status === "PENDING" || r.status === "APPROVED") &&
      can(viewer.actor, "timeOff.review", reviewResource(r.userId)),
  };
}

async function loadRequest(db: DbExecutor, viewer: Viewer, id: string): Promise<TimeOffRequestDTO> {
  const [row] = await selectRequests(db).where(
    and(eq(timeOffRequest.id, id), eq(timeOffRequest.workspaceId, viewer.workspaceId)),
  );
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  return toDTO(row, viewer);
}

const LIVE: TimeOffStatus[] = ["PENDING", "APPROVED"];

function spanOf(r: {
  start: string;
  end: string;
  halfDay: boolean;
  minutes: number | null;
}): TimeOffSpan {
  return { start: r.start, end: r.end, halfDay: r.halfDay, minutes: r.minutes };
}

/** The person's holiday dates in `[from, to]`. */
async function holidayKeys(
  db: DbExecutor,
  zone: WorkspaceZone,
  person: PersonContext,
  from: string,
  to: string,
) {
  return holidayKeysFor(await holidayRules(db, zone.id, from, to), person, from, to);
}

function emailBase(
  zone: WorkspaceZone,
  r: { policyName: string; start: string; end: string; amountCenti: number; unit: Row["unit"] },
) {
  return {
    appUrl: env().APP_URL,
    slug: zone.slug,
    workspaceName: zone.name,
    policyName: r.policyName,
    start: r.start,
    end: r.end,
    amountCenti: r.amountCenti,
    unit: r.unit,
  };
}

// --- Writes ------------------------------------------------------------------------

/**
 * What a request would take and leave, with every refusal it would meet: an
 * unassigned or archived policy (404), dates the core counting refuses, no
 * working days, an overlap with the person's own time off, and a balance that
 * would go below zero (pending counts). Run inside the person's lock to write.
 */
async function planRequest(
  tx: DbExecutor,
  zone: WorkspaceZone,
  viewer: Viewer,
  input: TimeOffRequestInput,
  today: string,
) {
  const person = await personContext(tx, zone, viewer.userId);
  const assigned = (await policiesFor(tx, zone, [person])).get(person.userId) ?? [];
  const mine = assigned.find((a) => a.policy.id === input.policyId);
  if (!mine) throw new WorkspaceAccessError(404, "Not found");
  const policy = mine.policy;
  const span: TimeOffSpan = {
    start: input.start,
    end: input.end,
    halfDay: policy.unit === "DAYS" && input.halfDay,
    minutes: policy.unit === "HOURS" ? requestMinutes(input) : null,
  };
  let amountCenti: number;
  try {
    const keys = await holidayKeys(tx, zone, person, span.start, span.end);
    amountCenti = countRequestCenti(policy.unit, span, person.capacity, keys);
  } catch (error) {
    throw new CatalogError("INVALID", (error as Error).message);
  }
  if (amountCenti === 0) {
    throw new CatalogError("INVALID", "These dates have no working days.");
  }
  const [overlap] = await tx
    .select({ start: timeOffRequest.startDate, end: timeOffRequest.endDate })
    .from(timeOffRequest)
    .where(
      and(
        eq(timeOffRequest.workspaceId, viewer.workspaceId),
        eq(timeOffRequest.userId, viewer.userId),
        inArray(timeOffRequest.status, LIVE),
        lte(timeOffRequest.startDate, span.end),
        gte(timeOffRequest.endDate, span.start),
      ),
    )
    .limit(1);
  if (overlap) {
    throw new CatalogError(
      "INVALID",
      `This overlaps your time off on ${formatTimeOffDates(overlap.start, overlap.end)}.`,
    );
  }
  const year = Number(span.start.slice(0, 4));
  const balance = (await balancesFor(tx, zone, [person], year, today))
    .get(person.userId)
    ?.find((b) => b.assigned.policy.id === policy.id)?.balance;
  if (balance && wouldGoNegative(balance, amountCenti, policy.allowNegative)) {
    throw new CatalogError("INVALID", `This would take ${policy.name} below zero.`);
  }
  return { person, policy, span, amountCenti, balance };
}

/** The dialog's preview: what the request takes and the balance before and after. */
export async function previewTimeOff(
  db: Database,
  viewer: Viewer,
  input: TimeOffRequestInput,
  now: Date = new Date(),
): Promise<TimeOffPreviewDTO> {
  assertCan(viewer.actor, "timeOff.request", { kind: "person", userId: viewer.userId });
  const zone = await workspaceZone(db, viewer.workspaceId);
  const plan = await planRequest(db, zone, viewer, input, localDateKey(now, zone.timezone));
  const available = plan.balance ? plan.balance.balanceCenti - plan.balance.pendingCenti : 0;
  return {
    amountCenti: plan.amountCenti,
    unit: plan.policy.unit,
    balanceCenti: available,
    afterCenti: available - plan.amountCenti,
    unlimited: plan.balance?.unlimited ?? false,
  };
}

export async function requestTimeOff(
  db: Database,
  viewer: Viewer,
  input: TimeOffRequestInput,
  now: Date = new Date(),
): Promise<TimeOffRequestDTO> {
  assertCan(viewer.actor, "timeOff.request", { kind: "person", userId: viewer.userId });
  const zone = await workspaceZone(db, viewer.workspaceId);
  const today = localDateKey(now, zone.timezone);
  const id = await db.transaction(async (tx) => {
    // The person's lock: two requests at once cannot both spend the last days.
    await tx.execute(timerLock(viewer.workspaceId, viewer.userId));
    const { person, policy, span, amountCenti } = await planRequest(tx, zone, viewer, input, today);
    const id = randomUUID();
    const approved = !policy.requiresApproval;
    await tx.insert(timeOffRequest).values({
      id,
      workspaceId: viewer.workspaceId,
      userId: viewer.userId,
      policyId: policy.id,
      startDate: span.start,
      endDate: span.end,
      halfDay: span.halfDay,
      minutes: span.minutes,
      amountCenti,
      note: input.note,
      status: approved ? "APPROVED" : "PENDING",
      decidedAt: approved ? now : null,
    });
    if (!approved) {
      const approvers = await approversFor(
        db,
        viewer.workspaceId,
        { userId: viewer.userId, projectIds: [] },
        "timeOff.review",
      );
      for (const approver of approvers) {
        await enqueueEmail(tx, {
          workspaceId: viewer.workspaceId,
          to: approver.email,
          kind: "timeOff.requested",
          ...timeOffRequestedEmail({
            ...emailBase(zone, {
              ...span,
              policyName: policy.name,
              amountCenti,
              unit: policy.unit,
            }),
            personName: person.name,
            note: input.note,
          }),
        });
      }
    }
    return id;
  });
  return loadRequest(db, viewer, id);
}

/** The person takes back their own pending request. */
export async function withdrawTimeOff(db: Database, viewer: Viewer, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select({ userId: timeOffRequest.userId, status: timeOffRequest.status })
      .from(timeOffRequest)
      .where(and(eq(timeOffRequest.id, id), eq(timeOffRequest.workspaceId, viewer.workspaceId)))
      .for("update");
    if (!r || r.userId !== viewer.userId) throw new WorkspaceAccessError(404, "Not found");
    if (r.status !== "PENDING") {
      throw new CatalogError("INVALID", "Only pending time off can be withdrawn.");
    }
    await tx
      .update(timeOffRequest)
      .set({ status: "CANCELLED", decidedBy: viewer.userId, decidedAt: new Date() })
      .where(eq(timeOffRequest.id, id));
  });
}

async function decisionEmail(
  tx: DbExecutor,
  zone: WorkspaceZone,
  r: Row,
  decision: "APPROVED" | "REJECTED" | "CANCELLED",
  note: string | null,
) {
  const [person] = await tx.select({ email: user.email }).from(user).where(eq(user.id, r.userId));
  if (!person) return;
  await enqueueEmail(tx, {
    workspaceId: zone.id,
    to: person.email,
    kind: "timeOff.decision",
    ...timeOffDecisionEmail({ ...emailBase(zone, r), decision, note }),
  });
}

/** Approve or reject pending requests: all of them, or none (an id out of reach is a 404). */
export async function reviewTimeOff(
  db: Database,
  viewer: Viewer,
  input: ReviewTimeOffInput,
): Promise<TimeOffRequestDTO[]> {
  if (input.decision === "REJECT" && !input.note) throw new CatalogError("INVALID", "Say why");
  const zone = await workspaceZone(db, viewer.workspaceId);
  const ids = [...new Set(input.ids)];
  await db.transaction(async (tx) => {
    const rows = await selectRequests(tx)
      .where(
        and(inArray(timeOffRequest.id, ids), eq(timeOffRequest.workspaceId, viewer.workspaceId)),
      )
      .for("update", { of: timeOffRequest });
    if (rows.length !== ids.length) throw new WorkspaceAccessError(404, "Not found");
    for (const r of rows) assertCan(viewer.actor, "timeOff.review", reviewResource(r.userId));
    if (rows.some((r) => r.status !== "PENDING")) {
      throw new CatalogError("INVALID", "Only pending time off can be approved or rejected.");
    }
    const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    await tx
      .update(timeOffRequest)
      .set({
        status,
        decidedBy: viewer.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      })
      .where(inArray(timeOffRequest.id, ids));
    for (const r of rows) await decisionEmail(tx, zone, r, status, input.note ?? null);
  });
  return Promise.all(ids.map((id) => loadRequest(db, viewer, id)));
}

/** A reviewer cancels approved time off, with a note; the days return to the balance. */
export async function cancelTimeOff(
  db: Database,
  viewer: Viewer,
  id: string,
  note: string,
): Promise<TimeOffRequestDTO> {
  const zone = await workspaceZone(db, viewer.workspaceId);
  await db.transaction(async (tx) => {
    const [r] = await selectRequests(tx)
      .where(and(eq(timeOffRequest.id, id), eq(timeOffRequest.workspaceId, viewer.workspaceId)))
      .for("update", { of: timeOffRequest });
    if (!r) throw new WorkspaceAccessError(404, "Not found");
    assertCan(viewer.actor, "timeOff.review", reviewResource(r.userId));
    if (r.status !== "APPROVED") {
      throw new CatalogError("INVALID", "Only approved time off can be cancelled.");
    }
    await tx
      .update(timeOffRequest)
      .set({
        status: "CANCELLED",
        decidedBy: viewer.userId,
        decidedAt: new Date(),
        decisionNote: note,
      })
      .where(eq(timeOffRequest.id, id));
    await decisionEmail(tx, zone, r, "CANCELLED", note);
  });
  return loadRequest(db, viewer, id);
}

// --- Reads -------------------------------------------------------------------------

/** The people whose requests the viewer may review (owners and admins: everyone). */
function reviewable(viewer: Viewer): string[] | null {
  if (viewer.role === "owner" || viewer.role === "admin") return null;
  return [...viewer.actor.managedUserIds].filter((u) =>
    can(viewer.actor, "timeOff.review", reviewResource(u)),
  );
}

export async function listTimeOffRequests(
  db: Database,
  viewer: Viewer,
  opts: { tab: TimeOffTab },
): Promise<TimeOffRequestDTO[]> {
  const ws = eq(timeOffRequest.workspaceId, viewer.workspaceId);
  const mine = eq(timeOffRequest.userId, viewer.userId);
  const people = reviewable(viewer);
  const theirs =
    people === null ? undefined : people.length ? inArray(timeOffRequest.userId, people) : null;
  let where;
  if (opts.tab === "mine") {
    where = and(ws, mine);
  } else if (opts.tab === "review") {
    if (theirs === null) return [];
    where = and(ws, eq(timeOffRequest.status, "PENDING"), theirs);
  } else {
    where = and(
      ws,
      ne(timeOffRequest.status, "PENDING"),
      theirs === null ? mine : theirs === undefined ? undefined : or(mine, theirs),
    );
  }
  const rows = await selectRequests(db)
    .where(where)
    .orderBy(desc(timeOffRequest.startDate), desc(timeOffRequest.createdAt))
    .limit(200);
  return rows.map((r) => toDTO(r, viewer));
}

/** One person's approved time off per day, and their holidays, for the timesheet and calendar. */
export async function timeOffRange(
  db: Database,
  viewer: Viewer,
  opts: { userId: string; from: string; to: string },
): Promise<TimeOffRangeDTO> {
  assertCan(viewer.actor, "timeOff.view", { kind: "person", userId: opts.userId });
  const zone = await workspaceZone(db, viewer.workspaceId);
  const person = await personContext(db, zone, opts.userId);
  const requests = await selectRequests(db).where(
    and(
      eq(timeOffRequest.workspaceId, viewer.workspaceId),
      eq(timeOffRequest.userId, opts.userId),
      eq(timeOffRequest.status, "APPROVED"),
      lte(timeOffRequest.startDate, opts.to),
      gte(timeOffRequest.endDate, opts.from),
    ),
  );
  const from = requests.reduce((m, r) => (r.start < m ? r.start : m), opts.from);
  const to = requests.reduce((m, r) => (r.end > m ? r.end : m), opts.to);
  const rules = await holidayRules(db, zone.id, from, to);
  const keys = holidayKeysFor(rules, person, from, to);
  const timeOff: TimeOffDayDTO[] = [];
  for (const r of requests) {
    for (const [dateKey, minutes] of timeOffMinutesByDay(
      r.unit,
      spanOf(r),
      person.capacity,
      keys,
    )) {
      if (dateKey < opts.from || dateKey > opts.to) continue;
      timeOff.push({ dateKey, minutes, policyName: r.policyName, status: "APPROVED" });
    }
  }
  timeOff.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  const holidays = holidaysInRange(
    rules.filter((h) => holidayApplies(h, person)),
    opts.from,
    opts.to,
  ).map((h) => ({ dateKey: h.dateKey, name: h.holiday.name }));
  return { timeOff, holidays };
}
