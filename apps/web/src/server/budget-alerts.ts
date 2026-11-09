import "server-only";

import {
  crossedThresholds,
  entryCurrency,
  formatDuration,
  formatMoney,
  isUndeliverable,
  type Progress,
} from "@timekeep/core";
import {
  and,
  client,
  type Database,
  emailOutbox,
  eq,
  inArray,
  like,
  membership,
  ne,
  project,
  projectMember,
  user,
} from "@timekeep/db";

import { budgetAlertEmail } from "./budget-emails";
import { env } from "./env";
import { estimateOf, progressFor } from "./estimates";
import { enqueueEmail } from "./outbox";

/**
 * Budget alerts (Phase 6b, decision 13): once a day, every live, estimated
 * project with alerts on is measured, and each threshold it has crossed is
 * emailed once per project, threshold and period (the outbox `kind`
 * `budget:<project>:<threshold>:<period>`) to the active owners and admins
 * and the project's managers.
 */

export interface BudgetZone {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  thresholds: number[];
}

const measureText = (p: Progress, value: number) =>
  p.kind === "TIME" ? formatDuration(value, "hh:mm:ss") : formatMoney(value, p.currency ?? "USD");

/** Active owners and admins, and each project's active managers, as addresses. */
async function recipients(db: Database, workspaceId: string, projectIds: string[]) {
  const [admins, managers] = await Promise.all([
    db
      .select({ email: user.email })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(
        and(
          eq(membership.workspaceId, workspaceId),
          eq(membership.status, "ACTIVE"),
          inArray(membership.role, ["owner", "admin"]),
        ),
      ),
    db
      .select({ projectId: projectMember.projectId, email: user.email })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .innerJoin(
        membership,
        and(eq(membership.workspaceId, workspaceId), eq(membership.userId, projectMember.userId)),
      )
      .where(
        and(
          inArray(projectMember.projectId, projectIds),
          eq(projectMember.isManager, true),
          eq(membership.status, "ACTIVE"),
          eq(membership.role, "manager"),
        ),
      ),
  ]);
  return (projectId: string): string[] => [
    ...new Set([
      ...admins.map((a) => a.email),
      ...managers.filter((m) => m.projectId === projectId).map((m) => m.email),
    ]),
  ];
}

/** Sends the budget alerts due for one workspace today; returns how many it queued. */
export async function evaluateBudgets(db: Database, zone: BudgetZone, now: Date): Promise<number> {
  if (zone.thresholds.length === 0) return 0;
  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      estimateKind: project.estimateKind,
      estimateSeconds: project.estimateSeconds,
      estimateMinor: project.estimateMinor,
      estimateReset: project.estimateReset,
      estimateAlerts: project.estimateAlerts,
      clientCurrency: client.currency,
    })
    .from(project)
    .leftJoin(client, eq(client.id, project.clientId))
    .where(
      and(
        eq(project.workspaceId, zone.id),
        ne(project.estimateKind, "NONE"),
        eq(project.estimateAlerts, true),
        eq(project.archived, false),
        eq(project.isTemplate, false),
      ),
    );
  if (rows.length === 0) return 0;
  const subjects = rows.map((r) => ({
    id: r.id,
    estimate: estimateOf(r),
    currency: entryCurrency(r.clientCurrency, zone.currency),
  }));
  const [progress, already, to] = await Promise.all([
    progressFor(db, zone.id, subjects, now, zone.timezone),
    db
      .select({ kind: emailOutbox.kind, to: emailOutbox.toAddress })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.workspaceId, zone.id), like(emailOutbox.kind, "budget:%")))
      .then((sent) => new Set(sent.map((r) => `${r.kind}|${r.to.toLowerCase()}`))),
    recipients(
      db,
      zone.id,
      rows.map((r) => r.id),
    ),
  ]);

  let sent = 0;
  for (const row of rows) {
    const p = progress.get(row.id);
    if (!p) continue;
    for (const threshold of crossedThresholds(p.used, p.estimate, zone.thresholds)) {
      const kind = `budget:${row.id}:${threshold}:${p.period.key}`;
      const content = budgetAlertEmail({
        appUrl: env().APP_URL,
        slug: zone.slug,
        workspaceName: zone.name,
        projectId: row.id,
        projectName: row.name,
        percent: p.percent,
        usedText: measureText(p, p.used),
        estimateText: measureText(p, p.estimate),
        periodLabel: p.period.label,
      });
      for (const address of to(row.id)) {
        const key = `${kind}|${address.toLowerCase()}`;
        if (isUndeliverable(address) || already.has(key)) continue;
        already.add(key);
        await enqueueEmail(db, { workspaceId: zone.id, to: address, kind, ...content });
        sent++;
      }
    }
  }
  return sent;
}
