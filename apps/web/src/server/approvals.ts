import "server-only";

import { randomUUID } from "node:crypto";

import {
  approvalRulesOf,
  type ApprovalStatus,
  can,
  formatPeriod,
  localDateKey,
  nextPeriod,
  type Period,
  periodBounds,
  periodContaining,
  periodOf,
  type PeriodRule,
  previousPeriod,
  type Resource,
} from "@timekeep/core";
import {
  and,
  approvalEvent,
  approvalRequest,
  asc,
  type Database,
  type DbExecutor,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  membership,
  sql,
  timeEntry,
  user,
  workspace,
  workspaceSettings,
} from "@timekeep/db";
import { alias } from "drizzle-orm/pg-core";

import type {
  ApprovalEventDTO,
  ApprovalRequestDTO,
  ApprovalsTab,
  MyPeriodDTO,
  PeriodTotals,
  PeriodViewDTO,
  UnsubmittedPeriodDTO,
} from "@/lib/approval-types";

import { WorkspaceAccessError } from "./access-error";
import { approvedEmail, rejectedEmail, reopenedEmail, submittedEmail } from "./approval-emails";
import { approversFor } from "./approvers";
import { assertCan } from "./authz";
import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";
import { env } from "./env";
import { enqueueEmail } from "./outbox";
import { timerLock } from "./person-lock";
import { listEntriesInRange } from "./time-entries";

/**
 * Approvals (Phase 5a, decisions 2-5): a person submits a period of their
 * time; an approver approves or rejects it, or reopens an approved one.
 * Periods are the workspace's (its timezone and week start). Emails go
 * through the outbox in the same transaction; callers drain it after the
 * response (`drainSoon`).
 */

type Executor = DbExecutor;

interface WorkspaceApproval {
  enabled: boolean;
  rule: PeriodRule;
  slug: string;
  name: string;
}

async function workspaceApproval(db: Executor, workspaceId: string): Promise<WorkspaceApproval> {
  const [row] = await db
    .select({
      slug: workspace.slug,
      name: workspace.name,
      timezone: workspaceSettings.timezone,
      weekStart: workspaceSettings.weekStart,
      approvalEnabled: workspaceSettings.approvalEnabled,
      approvalPeriod: workspaceSettings.approvalPeriod,
      lockMode: workspaceSettings.lockMode,
      lockDate: workspaceSettings.lockDate,
      lockDays: workspaceSettings.lockDays,
    })
    .from(workspace)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(eq(workspace.id, workspaceId));
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  const rules = approvalRulesOf(row, row);
  return { enabled: rules.enabled, rule: rules.period, slug: row.slug, name: row.name };
}

const decider = alias(user, "decider");

const requestColumns = {
  id: approvalRequest.id,
  userId: approvalRequest.userId,
  userName: user.name,
  periodStart: approvalRequest.periodStart,
  periodEnd: approvalRequest.periodEnd,
  status: approvalRequest.status,
  workSeconds: approvalRequest.workSeconds,
  billableSeconds: approvalRequest.billableSeconds,
  entryCount: approvalRequest.entryCount,
  submittedAt: approvalRequest.submittedAt,
  decidedBy: approvalRequest.decidedBy,
  decidedByName: decider.name,
  decidedAt: approvalRequest.decidedAt,
  note: approvalRequest.note,
};

function selectRequests(db: Executor) {
  return db
    .select(requestColumns)
    .from(approvalRequest)
    .leftJoin(user, eq(user.id, approvalRequest.userId))
    .leftJoin(decider, eq(decider.id, approvalRequest.decidedBy));
}

type RequestRow = Awaited<ReturnType<typeof selectRequests>>[number];

function toDTO(r: RequestRow): ApprovalRequestDTO {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.userName ?? "(former member)",
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    status: r.status,
    workSeconds: Number(r.workSeconds),
    billableSeconds: Number(r.billableSeconds),
    entryCount: r.entryCount,
    submittedAt: r.submittedAt.toISOString(),
    decidedBy: r.decidedBy ?? null,
    decidedByName: r.decidedByName ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    note: r.note ?? null,
  };
}

async function loadRequest(
  db: Executor,
  workspaceId: string,
  requestId: string,
): Promise<ApprovalRequestDTO> {
  const [row] = await selectRequests(db).where(
    and(eq(approvalRequest.workspaceId, workspaceId), eq(approvalRequest.id, requestId)),
  );
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  return toDTO(row);
}

/** The stopped work entries starting in the period. */
function periodEntries(workspaceId: string, userId: string, bounds: { from: Date; to: Date }) {
  return and(
    eq(timeEntry.workspaceId, workspaceId),
    eq(timeEntry.userId, userId),
    isNull(timeEntry.deletedAt),
    isNotNull(timeEntry.end),
    eq(timeEntry.type, "work"),
    gte(timeEntry.start, bounds.from),
    lt(timeEntry.start, bounds.to),
  );
}

async function totalsOf(
  db: Executor,
  workspaceId: string,
  userId: string,
  bounds: { from: Date; to: Date },
): Promise<PeriodTotals> {
  const [row] = await db
    .select({
      workSeconds: sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`.mapWith(
        Number,
      ),
      billableSeconds:
        sql<number>`coalesce(sum(case when ${timeEntry.billable} then ${timeEntry.durationSeconds} else 0 end), 0)::bigint`.mapWith(
          Number,
        ),
      entryCount: sql<number>`count(*)::int`,
    })
    .from(timeEntry)
    .where(periodEntries(workspaceId, userId, bounds));
  return row ?? { workSeconds: 0, billableSeconds: 0, entryCount: 0 };
}

/**
 * The projects of each request's entries ("" for an entry with no project,
 * which no project manager manages), for the `approval.review` resource.
 */
async function projectIdsOf(db: Executor, requestIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(requestIds.map((id) => [id, []]));
  if (requestIds.length === 0) return out;
  const rows = await db.execute<{ id: string; project_ids: string[] }>(sql`
    select r.id, array_agg(distinct coalesce(e.project_id, '')) as project_ids
    from approval_request r
    join workspace_settings s on s.workspace_id = r.workspace_id
    join time_entry e
      on e.workspace_id = r.workspace_id
     and e.user_id = r.user_id
     and e.deleted_at is null
     and e."end" is not null
     and e.type = 'work'
     and e.start >= (r.period_start::timestamp at time zone s.timezone)
     and e.start < ((r.period_end + 1)::timestamp at time zone s.timezone)
    where r.id = any(${sql.param(requestIds)}::text[])
    group by r.id
  `);
  for (const row of rows.rows) out.set(row.id, row.project_ids);
  return out;
}

function reviewResource(request: { userId: string }, projectIds: string[]): Resource {
  return { kind: "approval", userId: request.userId, projectIds };
}

async function emailOf(db: Executor, userId: string) {
  const [row] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId));
  return row ?? null;
}

async function logEvent(
  db: Pick<DbExecutor, "insert">,
  e: {
    workspaceId: string;
    requestId: string | null;
    userId: string;
    actorId: string;
    action: typeof approvalEvent.$inferInsert.action;
    note?: string | null;
  },
): Promise<void> {
  await db.insert(approvalEvent).values({ id: randomUUID(), ...e, note: e.note ?? null });
}

const SUBMITTED_STATUSES: ApprovalStatus[] = ["PENDING", "APPROVED"];

/** The viewer's PENDING or APPROVED requests overlapping `[start, end]` (date keys). */
async function overlapping(db: Executor, workspaceId: string, userId: string, period: Period) {
  return db
    .select({
      id: approvalRequest.id,
      status: approvalRequest.status,
      periodStart: approvalRequest.periodStart,
      periodEnd: approvalRequest.periodEnd,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.workspaceId, workspaceId),
        eq(approvalRequest.userId, userId),
        inArray(approvalRequest.status, SUBMITTED_STATUSES),
        lte(approvalRequest.periodStart, period.end),
        gte(approvalRequest.periodEnd, period.start),
      ),
    );
}

// --- Writes ------------------------------------------------------------------------

export async function submitPeriod(
  db: Database,
  viewer: Viewer,
  periodStart: string,
  now: Date = new Date(),
): Promise<ApprovalRequestDTO> {
  assertCan(viewer.actor, "approval.submit", {
    kind: "approval",
    userId: viewer.userId,
    projectIds: [],
  });
  const ws = await workspaceApproval(db, viewer.workspaceId);
  if (!ws.enabled) throw new CatalogError("INVALID", "Approval is off in this workspace.");
  const period = periodContaining(periodStart, ws.rule);
  if (period.start !== periodStart) {
    throw new CatalogError("INVALID", "Pick a period by its first day.");
  }
  const bounds = periodBounds(period, ws.rule.timezone);
  if (bounds.from.getTime() > now.getTime()) {
    throw new CatalogError("INVALID", "This period has not started yet.");
  }

  const id = await db.transaction(async (tx) => {
    // The entry guard takes the same lock: an edit either lands before the
    // totals or sees the request and is refused (Review Focus 3).
    await tx.execute(timerLock(viewer.workspaceId, viewer.userId));
    const [running] = await tx
      .select({ id: timeEntry.id })
      .from(timeEntry)
      .where(
        and(
          eq(timeEntry.workspaceId, viewer.workspaceId),
          eq(timeEntry.userId, viewer.userId),
          isNull(timeEntry.deletedAt),
          isNull(timeEntry.end),
          lt(timeEntry.start, bounds.to),
        ),
      );
    if (running) {
      throw new CatalogError("INVALID", "Stop the timer before submitting this period.");
    }
    const [taken] = await overlapping(tx, viewer.workspaceId, viewer.userId, period);
    if (taken) {
      throw new CatalogError(
        "CONFLICT",
        taken.periodStart === period.start && taken.periodEnd === period.end
          ? "This period is already submitted."
          : `This overlaps ${formatPeriod({ start: taken.periodStart, end: taken.periodEnd })}, already submitted.`,
      );
    }
    const totals = await totalsOf(tx, viewer.workspaceId, viewer.userId, bounds);
    const values = {
      periodEnd: period.end,
      status: "PENDING" as const,
      ...totals,
      submittedAt: now,
      decidedBy: null,
      decidedAt: null,
      note: null,
    };
    const [existing] = await tx
      .select({ id: approvalRequest.id })
      .from(approvalRequest)
      .where(
        and(
          eq(approvalRequest.workspaceId, viewer.workspaceId),
          eq(approvalRequest.userId, viewer.userId),
          eq(approvalRequest.periodStart, period.start),
        ),
      );
    const requestId = existing?.id ?? randomUUID();
    if (existing) {
      await tx.update(approvalRequest).set(values).where(eq(approvalRequest.id, requestId));
    } else {
      await tx.insert(approvalRequest).values({
        id: requestId,
        workspaceId: viewer.workspaceId,
        userId: viewer.userId,
        periodStart: period.start,
        ...values,
      });
    }
    await logEvent(tx, {
      workspaceId: viewer.workspaceId,
      requestId,
      userId: viewer.userId,
      actorId: viewer.userId,
      action: "SUBMIT",
    });
    const projectIds = (await projectIdsOf(tx, [requestId])).get(requestId) ?? [];
    const me = await emailOf(tx, viewer.userId);
    for (const approver of await approversFor(db, viewer.workspaceId, {
      userId: viewer.userId,
      projectIds,
    })) {
      await enqueueEmail(tx, {
        workspaceId: viewer.workspaceId,
        to: approver.email,
        kind: "approval.submitted",
        ...submittedEmail({
          appUrl: env().APP_URL,
          slug: ws.slug,
          workspaceName: ws.name,
          period,
          requestId,
          personName: me?.name ?? "Someone",
          workSeconds: totals.workSeconds,
        }),
      });
    }
    return requestId;
  });
  return loadRequest(db, viewer.workspaceId, id);
}

export async function withdrawRequest(
  db: Database,
  viewer: Viewer,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(approvalRequest)
      .where(
        and(
          eq(approvalRequest.workspaceId, viewer.workspaceId),
          eq(approvalRequest.id, requestId),
          eq(approvalRequest.userId, viewer.userId),
        ),
      )
      .for("update");
    if (!request) throw new WorkspaceAccessError(404, "Not found");
    if (request.status !== "PENDING") {
      throw new CatalogError("INVALID", "Only a pending period can be withdrawn.");
    }
    await tx.delete(approvalRequest).where(eq(approvalRequest.id, requestId));
    await logEvent(tx, {
      workspaceId: viewer.workspaceId,
      requestId: null,
      userId: viewer.userId,
      actorId: viewer.userId,
      action: "WITHDRAW",
    });
  });
}

export async function reviewRequests(
  db: Database,
  viewer: Viewer,
  input: { ids: string[]; decision: "APPROVE" | "REJECT"; note?: string },
  now: Date = new Date(),
): Promise<ApprovalRequestDTO[]> {
  const ids = [...new Set(input.ids)];
  if (input.decision === "REJECT" && !input.note) {
    throw new CatalogError("INVALID", "Say what needs fixing");
  }
  const ws = await workspaceApproval(db, viewer.workspaceId);
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(approvalRequest)
      .where(
        and(eq(approvalRequest.workspaceId, viewer.workspaceId), inArray(approvalRequest.id, ids)),
      )
      .for("update");
    if (rows.length !== ids.length) throw new WorkspaceAccessError(404, "Not found");
    const projects = await projectIdsOf(tx, ids);
    // Every request must be the reviewer's before any changes (all or nothing).
    for (const r of rows) {
      assertCan(viewer.actor, "approval.review", reviewResource(r, projects.get(r.id) ?? []));
    }
    if (rows.some((r) => r.status !== "PENDING")) {
      throw new CatalogError("INVALID", "Only pending periods can be approved or rejected.");
    }
    const approve = input.decision === "APPROVE";
    const note = approve ? null : input.note!;
    await tx
      .update(approvalRequest)
      .set({
        status: approve ? "APPROVED" : "REJECTED",
        decidedBy: viewer.userId,
        decidedAt: now,
        note,
      })
      .where(inArray(approvalRequest.id, ids));
    for (const r of rows) {
      await logEvent(tx, {
        workspaceId: viewer.workspaceId,
        requestId: r.id,
        userId: r.userId,
        actorId: viewer.userId,
        action: approve ? "APPROVE" : "REJECT",
        note,
      });
      if (r.userId === viewer.userId) continue;
      const person = await emailOf(tx, r.userId);
      if (!person) continue;
      const base = {
        appUrl: env().APP_URL,
        slug: ws.slug,
        workspaceName: ws.name,
        period: { start: r.periodStart, end: r.periodEnd },
      };
      await enqueueEmail(tx, {
        workspaceId: viewer.workspaceId,
        to: person.email,
        kind: approve ? "approval.approved" : "approval.rejected",
        ...(approve ? approvedEmail(base) : rejectedEmail({ ...base, note: note! })),
      });
    }
  });
  return Promise.all(ids.map((id) => loadRequest(db, viewer.workspaceId, id)));
}

/** Decision 3: an approved period goes back to its owner for correction, with a note. */
export async function reopenRequest(
  db: Database,
  viewer: Viewer,
  requestId: string,
  note: string,
  now: Date = new Date(),
): Promise<ApprovalRequestDTO> {
  const ws = await workspaceApproval(db, viewer.workspaceId);
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(approvalRequest)
      .where(
        and(eq(approvalRequest.workspaceId, viewer.workspaceId), eq(approvalRequest.id, requestId)),
      )
      .for("update");
    if (!r) throw new WorkspaceAccessError(404, "Not found");
    const projects = await projectIdsOf(tx, [r.id]);
    assertCan(viewer.actor, "approval.review", reviewResource(r, projects.get(r.id) ?? []));
    if (r.status !== "APPROVED") {
      throw new CatalogError("INVALID", "Only an approved period can be reopened.");
    }
    await tx
      .update(approvalRequest)
      .set({ status: "REJECTED", decidedBy: viewer.userId, decidedAt: now, note })
      .where(eq(approvalRequest.id, r.id));
    await logEvent(tx, {
      workspaceId: viewer.workspaceId,
      requestId: r.id,
      userId: r.userId,
      actorId: viewer.userId,
      action: "REOPEN",
      note,
    });
    const person = r.userId === viewer.userId ? null : await emailOf(tx, r.userId);
    if (person) {
      await enqueueEmail(tx, {
        workspaceId: viewer.workspaceId,
        to: person.email,
        kind: "approval.reopened",
        ...reopenedEmail({
          appUrl: env().APP_URL,
          slug: ws.slug,
          workspaceName: ws.name,
          period: { start: r.periodStart, end: r.periodEnd },
          note,
        }),
      });
    }
  });
  return loadRequest(db, viewer.workspaceId, requestId);
}

// --- Reads -------------------------------------------------------------------------

/** How many closed periods back the Unsubmitted tab looks. */
const UNSUBMITTED_PERIODS = 8;

export async function listApprovals(
  db: Database,
  viewer: Viewer,
  query: { tab: ApprovalsTab },
  now: Date = new Date(),
): Promise<ApprovalRequestDTO[] | UnsubmittedPeriodDTO[]> {
  if (query.tab === "unsubmitted") return listUnsubmitted(db, viewer, now);
  if (query.tab === "mine") {
    // Everyone's own requests, whatever their role (spec Part 1).
    const own = await selectRequests(db)
      .where(
        and(
          eq(approvalRequest.workspaceId, viewer.workspaceId),
          eq(approvalRequest.userId, viewer.userId),
        ),
      )
      .orderBy(desc(approvalRequest.periodStart))
      .limit(200);
    return own.map(toDTO);
  }
  const { actor } = viewer;
  const admin = actor.role === "owner" || actor.role === "admin";
  if (!admin && !mayReview(actor)) return [];
  // A team manager's people go into the query, so the limit cannot cut them off.
  const teamOnly = !admin && actor.settings.approvalReviewers === "TEAM_MANAGERS";
  if (teamOnly && actor.managedUserIds.size === 0) return [];
  const rows = await selectRequests(db)
    .where(
      and(
        eq(approvalRequest.workspaceId, viewer.workspaceId),
        query.tab === "pending"
          ? eq(approvalRequest.status, "PENDING")
          : inArray(approvalRequest.status, ["APPROVED", "REJECTED"]),
        teamOnly ? inArray(approvalRequest.userId, [...actor.managedUserIds]) : undefined,
      ),
    )
    .orderBy(
      ...(query.tab === "pending"
        ? [desc(approvalRequest.periodStart), asc(user.name)]
        : [desc(approvalRequest.decidedAt), desc(approvalRequest.periodStart)]),
    )
    .limit(500);
  if (admin) return rows.map(toDTO);
  // Only project-manager approvers need each request's projects.
  const projects =
    actor.settings.approvalReviewers === "PROJECT_MANAGERS"
      ? await projectIdsOf(
          db,
          rows.map((r) => r.id),
        )
      : new Map<string, string[]>();
  return rows
    .filter((r) => can(actor, "approval.review", reviewResource(r, projects.get(r.id) ?? [])))
    .map(toDTO);
}

/** Whether the actor may review anyone's period under the workspace's setting. */
function mayReview(actor: Viewer["actor"]): boolean {
  return actor.role === "manager" && actor.settings.approvalReviewers !== "ADMINS";
}

async function listUnsubmitted(
  db: Database,
  viewer: Viewer,
  now: Date,
): Promise<UnsubmittedPeriodDTO[]> {
  const ws = await workspaceApproval(db, viewer.workspaceId);
  const tz = ws.rule.timezone;
  const periods: Period[] = [];
  let p = previousPeriod(periodOf(now, ws.rule), ws.rule);
  for (let i = 0; i < UNSUBMITTED_PERIODS; i++) {
    periods.unshift(p);
    p = previousPeriod(p, ws.rule);
  }
  const first = periods[0]!;
  const last = periods.at(-1)!;
  const range = { from: periodBounds(first, tz).from, to: periodBounds(last, tz).to };

  // The people the viewer may review whatever their projects: everyone for
  // owners and admins, a manager's own people (the Unsubmitted tab has no
  // request whose projects a project manager could check).
  const people = (
    await db
      .select({ userId: membership.userId, name: user.name })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.status, "ACTIVE")))
  ).filter((m) =>
    can(viewer.actor, "approval.review", { kind: "approval", userId: m.userId, projectIds: [] }),
  );
  if (people.length === 0) return [];
  const names = new Map(people.map((m) => [m.userId, m.name]));

  const day = sql<string>`to_char((${timeEntry.start} at time zone ${tz})::date, 'YYYY-MM-DD')`;
  const sums = await db
    .select({
      userId: timeEntry.userId,
      day,
      seconds: sql<number>`sum(${timeEntry.durationSeconds})::bigint`.mapWith(Number),
      count: sql<number>`count(*)::int`,
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, viewer.workspaceId),
        inArray(timeEntry.userId, [...names.keys()]),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        eq(timeEntry.type, "work"),
        gte(timeEntry.start, range.from),
        lt(timeEntry.start, range.to),
      ),
    )
    .groupBy(timeEntry.userId, sql.raw("2"));
  const requests = await db
    .select({
      userId: approvalRequest.userId,
      periodStart: approvalRequest.periodStart,
      periodEnd: approvalRequest.periodEnd,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.workspaceId, viewer.workspaceId),
        inArray(approvalRequest.status, SUBMITTED_STATUSES),
        lte(approvalRequest.periodStart, last.end),
        gte(approvalRequest.periodEnd, first.start),
      ),
    );

  const out: UnsubmittedPeriodDTO[] = [];
  for (const period of periods) {
    for (const [userId, userName] of names) {
      const covered = requests.some(
        (r) => r.userId === userId && r.periodStart <= period.end && r.periodEnd >= period.start,
      );
      if (covered) continue;
      const inPeriod = sums.filter(
        (s) => s.userId === userId && s.day >= period.start && s.day <= period.end,
      );
      const workSeconds = inPeriod.reduce((n, s) => n + s.seconds, 0);
      if (workSeconds === 0) continue;
      out.push({
        userId,
        userName,
        periodStart: period.start,
        periodEnd: period.end,
        workSeconds,
        entryCount: inPeriod.reduce((n, s) => n + s.count, 0),
      });
    }
  }
  return out.sort(
    (a, b) => b.periodStart.localeCompare(a.periodStart) || a.userName.localeCompare(b.userName),
  );
}

/** One request's days, totals and history: for its owner and those who may review it. */
export async function periodView(
  db: Database,
  viewer: Viewer,
  requestId: string,
): Promise<PeriodViewDTO> {
  const request = await loadRequest(db, viewer.workspaceId, requestId);
  const projectIds = (await projectIdsOf(db, [requestId])).get(requestId) ?? [];
  const reviewer = can(viewer.actor, "approval.review", reviewResource(request, projectIds));
  if (!reviewer && request.userId !== viewer.userId) {
    throw new WorkspaceAccessError(404, "Not found");
  }
  const ws = await workspaceApproval(db, viewer.workspaceId);
  const tz = ws.rule.timezone;
  const period = { start: request.periodStart, end: request.periodEnd };
  const entries = await listEntriesInRange(
    db,
    { workspaceId: viewer.workspaceId, userId: request.userId },
    periodBounds(period, tz),
  );
  const days = new Map<string, PeriodViewDTO["days"][number]>();
  const live: PeriodTotals = { workSeconds: 0, billableSeconds: 0, entryCount: 0 };
  for (const e of entries) {
    const key = localDateKey(new Date(e.start), tz);
    const d = days.get(key) ?? { dateKey: key, entries: [], workSeconds: 0 };
    d.entries.push(e);
    if (e.type === "work") {
      const seconds = e.durationSeconds ?? 0;
      d.workSeconds += seconds;
      live.workSeconds += seconds;
      if (e.billable) live.billableSeconds += seconds;
      live.entryCount++;
    }
    days.set(key, d);
  }
  const actor = alias(user, "actor");
  const events = await db
    .select({
      id: approvalEvent.id,
      action: approvalEvent.action,
      actorName: actor.name,
      note: approvalEvent.note,
      entryId: approvalEvent.entryId,
      changes: approvalEvent.changes,
      createdAt: approvalEvent.createdAt,
    })
    .from(approvalEvent)
    .leftJoin(actor, eq(actor.id, approvalEvent.actorId))
    .where(
      and(
        eq(approvalEvent.workspaceId, viewer.workspaceId),
        eq(approvalEvent.requestId, requestId),
      ),
    )
    .orderBy(asc(approvalEvent.createdAt));
  return {
    request,
    period,
    timezone: tz,
    days: [...days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    totals: {
      workSeconds: request.workSeconds,
      billableSeconds: request.billableSeconds,
      entryCount: request.entryCount,
    },
    live,
    events: events.map((e): ApprovalEventDTO => ({
      ...e,
      actorName: e.actorName ?? null,
      changes: e.changes ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    canReview: reviewer && request.status === "PENDING",
    canReopen: reviewer && request.status === "APPROVED",
  };
}

/** The viewer's own periods overlapping `[from, to)`, for the Submit control. */
export async function myPeriods(
  db: Database,
  viewer: Viewer,
  range: { from: Date; to: Date },
  now: Date = new Date(),
): Promise<MyPeriodDTO[]> {
  const ws = await workspaceApproval(db, viewer.workspaceId);
  if (!ws.enabled) return [];
  const tz = ws.rule.timezone;
  const periods: Period[] = [];
  for (
    let p = periodOf(range.from, ws.rule);
    periodBounds(p, tz).from.getTime() < range.to.getTime() && periods.length < 62;
    p = nextPeriod(p, ws.rule)
  ) {
    periods.push(p);
  }
  if (periods.length === 0) return [];
  const span = { start: periods[0]!.start, end: periods.at(-1)!.end };
  const requests = await db
    .select({
      id: approvalRequest.id,
      status: approvalRequest.status,
      note: approvalRequest.note,
      periodStart: approvalRequest.periodStart,
      periodEnd: approvalRequest.periodEnd,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.workspaceId, viewer.workspaceId),
        eq(approvalRequest.userId, viewer.userId),
        lte(approvalRequest.periodStart, span.end),
        gte(approvalRequest.periodEnd, span.start),
      ),
    );
  const maySubmit = can(viewer.actor, "approval.submit", {
    kind: "approval",
    userId: viewer.userId,
    projectIds: [],
  });
  const out: MyPeriodDTO[] = [];
  for (const period of periods) {
    const bounds = periodBounds(period, tz);
    const own = requests.find((r) => r.periodStart === period.start);
    const blocking = requests.find(
      (r) =>
        r.id !== own?.id &&
        (SUBMITTED_STATUSES as string[]).includes(r.status) &&
        r.periodStart <= period.end &&
        r.periodEnd >= period.start,
    );
    const request = own ?? blocking ?? null;
    const { workSeconds } = await totalsOf(db, viewer.workspaceId, viewer.userId, bounds);
    out.push({
      period,
      status: request?.status ?? null,
      note: request?.note ?? null,
      requestId: request?.id ?? null,
      workSeconds,
      canSubmit:
        maySubmit &&
        !blocking &&
        (own === undefined || own.status === "REJECTED") &&
        bounds.from.getTime() <= now.getTime(),
    });
  }
  return out;
}

// --- Settings ----------------------------------------------------------------------

async function pendingCount(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvalRequest)
    .where(
      and(eq(approvalRequest.workspaceId, workspaceId), eq(approvalRequest.status, "PENDING")),
    );
  return row?.n ?? 0;
}

interface ApprovalSettingsShape {
  approvalEnabled: boolean;
  approvalPeriod: string;
  timezone: string;
  weekStart: number;
}

/**
 * What the settings change needs first (decision 2): a new period type waits
 * until nothing is pending; turning approval off asks before it withdraws the
 * pending periods. Null when the change may go ahead.
 */
export async function checkApprovalSettings(
  db: Executor,
  workspaceId: string,
  current: ApprovalSettingsShape,
  next: ApprovalSettingsShape,
  confirmedOff: boolean,
): Promise<{
  field: "approvalPeriod" | "timezone" | "weekStart" | "confirmApprovalOff";
  message: string;
} | null> {
  // Periods are made of the period type, the workspace timezone and its week start:
  // changing any of them would move the periods of pending requests.
  const moved = (["approvalPeriod", "timezone", "weekStart"] as const).find(
    (f) => next[f] !== current[f],
  );
  const periodChanged = moved !== undefined;
  const turningOff = current.approvalEnabled && !next.approvalEnabled;
  if (!periodChanged && !turningOff) return null;
  const n = await pendingCount(db, workspaceId);
  if (n === 0) return null;
  if (turningOff) {
    if (confirmedOff) return null;
    return {
      field: "confirmApprovalOff",
      message: `${n} pending ${n === 1 ? "period" : "periods"} will be withdrawn.`,
    };
  }
  return { field: moved!, message: "Approve or reject the pending periods first." };
}

/** Turning approval off: every pending request is withdrawn, logged as AUTO_WITHDRAW. */
export async function withdrawPendingRequests(
  tx: Executor,
  workspaceId: string,
  actorId: string,
): Promise<number> {
  const removed = await tx
    .delete(approvalRequest)
    .where(and(eq(approvalRequest.workspaceId, workspaceId), eq(approvalRequest.status, "PENDING")))
    .returning({ userId: approvalRequest.userId });
  for (const r of removed) {
    await logEvent(tx, {
      workspaceId,
      requestId: null,
      userId: r.userId,
      actorId,
      action: "AUTO_WITHDRAW",
    });
  }
  return removed.length;
}
