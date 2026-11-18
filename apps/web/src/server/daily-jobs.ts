import "server-only";

import {
  addDaysToKey,
  approvalRulesOf,
  budgetThresholdsOf,
  isUndeliverable,
  localDateKey,
  localTimeParts,
  periodBounds,
  periodContaining,
  previousPeriod,
} from "@timekeep/core";
import {
  and,
  dailyJobRun,
  type Database,
  emailOutbox,
  eq,
  expense,
  gte,
  inArray,
  invoice,
  isNotNull,
  isNull,
  lt,
  lte,
  membership,
  or,
  project,
  recurringInvoice,
  sql,
  targetRule,
  timeEntry,
  user,
  userSettings,
  workspace,
  workspaceSettings,
} from "@timekeep/db";

import { e2eOnlyWorkspaceIds } from "@timekeep/db/e2e-tenant";

import { unsubmittedReminderEmail } from "./approval-emails";
import { evaluateBudgets } from "./budget-alerts";
import { env } from "./env";
import { sendOverdueEmails } from "./invoices/overdue";
import { runRecurringInvoices } from "./invoices/recurring";
import { enqueueEmail } from "./outbox";
import { evaluateTargets } from "./targets";

/** The local hour from which a workspace's day is run (backlog ruling 9). */
export const DAILY_RUN_HOUR = 7;
/** A claim this old with no finish is taken again (the run was killed). */
const CLAIM_LEASE_MS = 2 * 60 * 60 * 1000;
/** Days after a period ends in which its reminder still goes, if a day was missed. */
const REMINDER_CATCH_UP_DAYS = 3;

/**
 * Claims a workspace's local day for its daily run: true for the one caller
 * that may run it. A claim left unfinished past its lease is taken again.
 */
export async function claimDailyRun(
  db: Database,
  workspaceId: string,
  localDate: string,
  now: Date,
): Promise<boolean> {
  const [claimed] = await db
    .insert(dailyJobRun)
    .values({ workspaceId, localDate, claimedAt: now })
    .onConflictDoUpdate({
      target: [dailyJobRun.workspaceId, dailyJobRun.localDate],
      set: { claimedAt: now },
      setWhere: and(
        isNull(dailyJobRun.finishedAt),
        lt(dailyJobRun.claimedAt, new Date(now.getTime() - CLAIM_LEASE_MS)),
      ),
    })
    .returning({ workspaceId: dailyJobRun.workspaceId });
  return claimed !== undefined;
}

async function finishDailyRun(db: Database, workspaceId: string, localDate: string, now: Date) {
  await db
    .update(dailyJobRun)
    .set({ finishedAt: now })
    .where(and(eq(dailyJobRun.workspaceId, workspaceId), eq(dailyJobRun.localDate, localDate)));
}

/**
 * The daily jobs. Vercel Cron calls them every hour; each workspace runs once
 * per local day, in the first call at or after 07:00 in its timezone, claimed
 * in `daily_job_run` (the e2e hook and the tests pass `force` to skip the hour
 * and the claim). Each workspace is evaluated in its own timezone: within
 * three local days after one of its periods ends, everyone with stopped work
 * in that period and no submission gets one reminder (unless they muted
 * reminders). Then the target rules (Phase 5b): yesterday for DAY
 * rules, last week on the week's first day. Then the budget alerts (Phase 6b):
 * each threshold an estimated project has crossed. Idempotent: each outbox
 * row's kind names its period, or its rule, person and day, or its project,
 * threshold and period.
 */
export interface DailyJobsResult {
  reminders: number;
  targets: number;
  budgets: number;
  /** Phase 6d: recurring invoices created and sent, overdue invoices announced. */
  invoices: { created: number; sent: number; overdue: number };
}

export async function runDailyJobs(
  db: Database,
  opts: { now?: Date; workspaceIds?: string[]; force?: boolean } = {},
): Promise<DailyJobsResult> {
  const now = opts.now ?? new Date();
  const workspaces = await db
    .select({
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      timezone: workspaceSettings.timezone,
      weekStart: workspaceSettings.weekStart,
      approvalEnabled: workspaceSettings.approvalEnabled,
      approvalPeriod: workspaceSettings.approvalPeriod,
      lockMode: workspaceSettings.lockMode,
      lockDate: workspaceSettings.lockDate,
      lockDays: workspaceSettings.lockDays,
      currency: workspaceSettings.currency,
      budgetThresholds: workspaceSettings.budgetThresholds,
    })
    .from(workspace)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(
      and(
        or(
          eq(workspaceSettings.approvalEnabled, true),
          sql`exists (select 1 from ${targetRule} where ${targetRule.workspaceId} = ${workspace.id} and ${targetRule.active})`,
          sql`exists (select 1 from ${project} where ${project.workspaceId} = ${workspace.id} and ${project.estimateKind} <> 'NONE' and ${project.estimateAlerts} and not ${project.archived} and not ${project.isTemplate})`,
          // Phase 6d: a recurring template to run, or a sent invoice that may fall overdue.
          sql`exists (select 1 from ${recurringInvoice} where ${recurringInvoice.workspaceId} = ${workspace.id} and ${recurringInvoice.active})`,
          sql`exists (select 1 from ${invoice} where ${invoice.workspaceId} = ${workspace.id} and ${invoice.status} = 'SENT')`,
        ),
        opts.workspaceIds ? inArray(workspace.id, opts.workspaceIds) : undefined,
      ),
    )
    .orderBy(workspace.createdAt, workspace.id);

  let reminders = 0;
  let targets = 0;
  let budgets = 0;
  const invoices = { created: 0, sent: 0, overdue: 0 };
  for (const ws of workspaces) {
    // One workspace's failure is logged and never stops the others (Phase 6d review).
    const { enabled, period: rule } = approvalRulesOf(ws, ws);
    const today = localDateKey(now, rule.timezone);
    if (!opts.force && localTimeParts(now, rule.timezone).hours < DAILY_RUN_HOUR) continue;
    try {
      // Inside the try: a claim that fails is this workspace's problem, retried next hour.
      if (!opts.force && !(await claimDailyRun(db, ws.id, today, now))) continue;
      // The period that ended last, reminded within a few days so a missed day is not lost.
      const ended = previousPeriod(periodContaining(today, rule), rule);
      if (enabled && today <= addDaysToKey(ended.end, REMINDER_CATCH_UP_DAYS)) {
        reminders += await remindUnsubmitted(db, ws, ended);
      }
      targets += await evaluateTargets(
        db,
        {
          id: ws.id,
          slug: ws.slug,
          name: ws.name,
          timezone: rule.timezone,
          weekStart: ws.weekStart,
        },
        now,
      );
      budgets += await evaluateBudgets(
        db,
        {
          id: ws.id,
          slug: ws.slug,
          name: ws.name,
          timezone: rule.timezone,
          currency: ws.currency,
          thresholds: budgetThresholdsOf(ws),
        },
        now,
      );
      const zone = {
        id: ws.id,
        slug: ws.slug,
        name: ws.name,
        timezone: rule.timezone,
        currency: ws.currency,
      };
      const recurring = await runRecurringInvoices(db, zone, now);
      invoices.created += recurring.created;
      invoices.sent += recurring.sent;
      invoices.overdue += await sendOverdueEmails(db, zone, now);
      if (!opts.force) await finishDailyRun(db, ws.id, today, now);
    } catch (error) {
      console.error(`[daily] workspace ${ws.slug} failed`, error);
    }
  }
  return { reminders, targets, budgets, invoices };
}

async function remindUnsubmitted(
  db: Database,
  ws: { id: string; slug: string; name: string; timezone: string },
  period: { start: string; end: string },
): Promise<number> {
  const bounds = periodBounds(period, ws.timezone);
  const kind = `approval.unsubmitted:${period.start}`;
  const people = await db
    .select({
      userId: timeEntry.userId,
      email: user.email,
      seconds: sql<number>`sum(${timeEntry.durationSeconds})::bigint`.mapWith(Number),
    })
    .from(timeEntry)
    .innerJoin(
      membership,
      and(
        eq(membership.workspaceId, timeEntry.workspaceId),
        eq(membership.userId, timeEntry.userId),
      ),
    )
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .leftJoin(userSettings, eq(userSettings.userId, timeEntry.userId))
    .where(
      and(
        eq(timeEntry.workspaceId, ws.id),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        eq(timeEntry.type, "work"),
        gte(timeEntry.start, bounds.from),
        lt(timeEntry.start, bounds.to),
        eq(membership.status, "ACTIVE"),
        sql`coalesce(${userSettings.muteTargetReminders}, false) = false`,
        // No PENDING or APPROVED request overlaps the period.
        sql`not exists (
          select 1 from approval_request r
          where r.workspace_id = ${ws.id}
            and r.user_id = ${timeEntry.userId}
            and r.status in ('PENDING', 'APPROVED')
            and r.period_start <= ${period.end}
            and r.period_end >= ${period.start}
        )`,
      ),
    )
    .groupBy(timeEntry.userId, user.email);
  // The same people rule over expenses dated in the period: someone with only
  // expenses there has something to submit too.
  const spenders = await db
    .select({
      userId: expense.userId,
      email: user.email,
      count: sql<number>`count(*)::int`,
    })
    .from(expense)
    .innerJoin(
      membership,
      and(eq(membership.workspaceId, expense.workspaceId), eq(membership.userId, expense.userId)),
    )
    .innerJoin(user, eq(user.id, expense.userId))
    .leftJoin(userSettings, eq(userSettings.userId, expense.userId))
    .where(
      and(
        eq(expense.workspaceId, ws.id),
        isNull(expense.deletedAt),
        gte(expense.date, period.start),
        lte(expense.date, period.end),
        eq(membership.status, "ACTIVE"),
        sql`coalesce(${userSettings.muteTargetReminders}, false) = false`,
        sql`not exists (
          select 1 from approval_request r
          where r.workspace_id = ${ws.id}
            and r.user_id = ${expense.userId}
            and r.status in ('PENDING', 'APPROVED')
            and r.period_start <= ${period.end}
            and r.period_end >= ${period.start}
        )`,
      ),
    )
    .groupBy(expense.userId, user.email);
  const waiting = new Map<string, { email: string; seconds: number; expenses: number }>();
  for (const p of people)
    waiting.set(p.userId, { email: p.email, seconds: p.seconds, expenses: 0 });
  for (const p of spenders) {
    const known = waiting.get(p.userId);
    if (known) known.expenses = p.count;
    else waiting.set(p.userId, { email: p.email, seconds: 0, expenses: p.count });
  }
  if (waiting.size === 0) return 0;

  const already = new Set(
    (
      await db
        .select({ to: emailOutbox.toAddress })
        .from(emailOutbox)
        .where(and(eq(emailOutbox.workspaceId, ws.id), eq(emailOutbox.kind, kind)))
    ).map((r) => r.to.toLowerCase()),
  );
  let sent = 0;
  for (const p of waiting.values()) {
    if (p.seconds <= 0 && p.expenses <= 0) continue;
    if (isUndeliverable(p.email) || already.has(p.email.toLowerCase())) continue;
    await enqueueEmail(db, {
      workspaceId: ws.id,
      to: p.email,
      kind,
      ...unsubmittedReminderEmail({
        appUrl: env().APP_URL,
        slug: ws.slug,
        workspaceName: ws.name,
        period,
        workSeconds: p.seconds,
        expenseCount: p.expenses,
      }),
    });
    sent++;
  }
  return sent;
}

/**
 * The workspace the e2e hook may run the daily job for: one whose members are
 * all e2e or demo users (production and previews share the database, and
 * e2e stays in its own tenants). Null for a customer's workspace or none.
 */
export async function e2eWorkspaceId(db: Database, slug: string): Promise<string | null> {
  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.slug, slug))
    .limit(1);
  if (!ws) return null;
  return (await e2eOnlyWorkspaceIds(db)).includes(ws.id) ? ws.id : null;
}
