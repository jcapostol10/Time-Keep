import "server-only";

import {
  approvalRulesOf,
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
  sql,
  timeEntry,
  user,
  userSettings,
  workspace,
  workspaceSettings,
} from "@timekeep/db";

import { unsubmittedReminderEmail } from "./approval-emails";
import { env } from "./env";
import { enqueueEmail } from "./outbox";

/**
 * The once-a-day jobs (Vercel Cron at 22:00 UTC, 06:00 in Manila; the e2e
 * hook for one workspace). Each workspace is evaluated in its own timezone:
 * on the first local day after one of its periods ends, everyone with
 * stopped work in that period and no submission gets one reminder (unless
 * they muted reminders). Idempotent: the outbox row's kind names the period.
 */
export async function runDailyJobs(
  db: Database,
  opts: { now?: Date; workspaceIds?: string[] } = {},
): Promise<{ reminders: number }> {
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
    })
    .from(workspace)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceSettings.approvalEnabled, true),
        opts.workspaceIds ? inArray(workspace.id, opts.workspaceIds) : undefined,
      ),
    );

  let reminders = 0;
  for (const ws of workspaces) {
    const { period: rule } = approvalRulesOf(ws, ws);
    const today = localDateKey(now, rule.timezone);
    if (periodContaining(today, rule).start !== today) continue;
    const ended = previousPeriod(periodContaining(today, rule), rule);
    reminders += await remindUnsubmitted(db, ws, ended);
  }
  return { reminders };
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
