import "server-only";

import {
  approvalRulesOf,
  budgetThresholdsOf,
  isUndeliverable,
  localDateKey,
  periodBounds,
  periodContaining,
  previousPeriod,
} from "@timekeep/core";
import {
  and,
  type Database,
  emailOutbox,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  membership,
  or,
  project,
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
import { enqueueEmail } from "./outbox";
import { evaluateTargets } from "./targets";

/**
 * The once-a-day jobs (Vercel Cron at 22:00 UTC, 06:00 in Manila; the e2e
 * hook for one workspace). Each workspace is evaluated in its own timezone:
 * on the first local day after one of its periods ends, everyone with
 * stopped work in that period and no submission gets one reminder (unless
 * they muted reminders). Then the target rules (Phase 5b): yesterday for DAY
 * rules, last week on the week's first day. Then the budget alerts (Phase 6b):
 * each threshold an estimated project has crossed. Idempotent: each outbox
 * row's kind names its period, or its rule, person and day, or its project,
 * threshold and period.
 */
export async function runDailyJobs(
  db: Database,
  opts: { now?: Date; workspaceIds?: string[] } = {},
): Promise<{ reminders: number; targets: number; budgets: number }> {
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
        ),
        opts.workspaceIds ? inArray(workspace.id, opts.workspaceIds) : undefined,
      ),
    );

  let reminders = 0;
  let targets = 0;
  let budgets = 0;
  for (const ws of workspaces) {
    const { enabled, period: rule } = approvalRulesOf(ws, ws);
    const today = localDateKey(now, rule.timezone);
    if (enabled && periodContaining(today, rule).start === today) {
      const ended = previousPeriod(periodContaining(today, rule), rule);
      reminders += await remindUnsubmitted(db, ws, ended);
    }
    targets += await evaluateTargets(
      db,
      { id: ws.id, slug: ws.slug, name: ws.name, timezone: rule.timezone, weekStart: ws.weekStart },
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
  }
  return { reminders, targets, budgets };
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
  if (people.length === 0) return 0;

  const already = new Set(
    (
      await db
        .select({ to: emailOutbox.toAddress })
        .from(emailOutbox)
        .where(and(eq(emailOutbox.workspaceId, ws.id), eq(emailOutbox.kind, kind)))
    ).map((r) => r.to.toLowerCase()),
  );
  let sent = 0;
  for (const p of people) {
    if (p.seconds <= 0 || isUndeliverable(p.email) || already.has(p.email.toLowerCase())) continue;
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
