import "server-only";

import { randomUUID } from "node:crypto";

import {
  addDaysToKey,
  isUndeliverable,
  localDateKey,
  type TargetRule,
  type TargetRuleInput,
  targetApplies,
  targetBreached,
  thresholdMinutes,
  timeOffMinutesByDay,
  weekdayOfKey,
  holidayKeysFor,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  emailOutbox,
  eq,
  gte,
  inArray,
  like,
  lte,
  managedGroup,
  managedUser,
  membership,
  targetRule,
  targetRuleAssignee,
  timeOffPolicy,
  timeOffRequest,
  user,
  userGroupMember,
  userSettings,
} from "@timekeep/db";

import type { TargetRuleDTO } from "@/lib/target-types";

import { WorkspaceAccessError } from "./access-error";
import { workByPersonDay } from "./attendance";
import { assertCan } from "./authz";
import type { Viewer } from "./catalog/viewer";
import { env } from "./env";
import { enqueueEmail } from "./outbox";
import { overTargetEmail, underTargetEmail } from "./target-emails";
import { holidayRules } from "./time-off/holidays";
import { type PersonContext, peopleContext, type WorkspaceZone } from "./time-off/people";
import { assertPeopleAndGroups, assigneeDiff } from "./time-off/policies";

/**
 * Target rules (Phase 5b, decision 14). UNDER reminds the person who tracked
 * too little (unless they muted target reminders); OVER alerts the active
 * owners and admins and the person's managers, never muted. The daily job
 * evaluates yesterday for DAY rules and, on the first day of the week, last
 * week for WEEK rules, in the workspace's timezone; each email goes once per
 * (rule, person, day or week) through its outbox `kind`.
 */

async function rulesOf(db: Database, workspaceId: string): Promise<TargetRuleDTO[]> {
  const rows = await db
    .select()
    .from(targetRule)
    .where(eq(targetRule.workspaceId, workspaceId))
    .orderBy(asc(targetRule.createdAt));
  const assignees = rows.length
    ? await db
        .select({
          ruleId: targetRuleAssignee.ruleId,
          userId: targetRuleAssignee.userId,
          groupId: targetRuleAssignee.groupId,
        })
        .from(targetRuleAssignee)
        .where(
          inArray(
            targetRuleAssignee.ruleId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((r) => {
    const mine = assignees.filter((a) => a.ruleId === r.id);
    return {
      id: r.id,
      kind: r.kind,
      period: r.period,
      thresholdMinutes: r.thresholdMinutes,
      active: r.active,
      everyone: r.everyone,
      userIds: mine.flatMap((a) => (a.userId ? [a.userId] : [])),
      groupIds: mine.flatMap((a) => (a.groupId ? [a.groupId] : [])),
    };
  });
}

export async function listTargetRules(db: Database, viewer: Viewer): Promise<TargetRuleDTO[]> {
  assertCan(viewer.actor, "target.manage", { kind: "none" });
  return rulesOf(db, viewer.workspaceId);
}

export async function saveTargetRule(
  db: Database,
  viewer: Viewer,
  input: TargetRuleInput,
  id?: string,
): Promise<TargetRuleDTO> {
  assertCan(viewer.actor, "target.manage", { kind: "none" });
  const ruleId = await db.transaction(async (tx) => {
    await assertPeopleAndGroups(tx, viewer.workspaceId, input.userIds, input.groupIds);
    const values = {
      kind: input.kind,
      period: input.period,
      thresholdMinutes: thresholdMinutes(input),
      active: input.active,
      everyone: input.everyone,
    };
    let ruleId = id;
    if (ruleId) {
      const rows = await tx
        .update(targetRule)
        .set(values)
        .where(and(eq(targetRule.id, ruleId), eq(targetRule.workspaceId, viewer.workspaceId)))
        .returning({ id: targetRule.id });
      if (rows.length === 0) throw new WorkspaceAccessError(404, "Not found");
    } else {
      ruleId = randomUUID();
      await tx
        .insert(targetRule)
        .values({ id: ruleId, workspaceId: viewer.workspaceId, ...values });
    }
    const t = targetRuleAssignee;
    const current = await tx
      .select({ id: t.id, userId: t.userId, groupId: t.groupId })
      .from(t)
      .where(eq(t.ruleId, ruleId));
    const { dropIds, add } = assigneeDiff(
      current,
      input.everyone ? { userIds: [], groupIds: [] } : input,
    );
    if (dropIds.length) await tx.delete(t).where(inArray(t.id, dropIds));
    if (add.length) {
      await tx.insert(t).values(add.map((a) => ({ id: randomUUID(), ruleId: ruleId!, ...a })));
    }
    return ruleId;
  });
  const dto = (await rulesOf(db, viewer.workspaceId)).find((r) => r.id === ruleId);
  if (!dto) throw new WorkspaceAccessError(404, "Not found");
  return dto;
}

export async function deleteTargetRule(db: Database, viewer: Viewer, id: string): Promise<void> {
  assertCan(viewer.actor, "target.manage", { kind: "none" });
  const rows = await db
    .delete(targetRule)
    .where(and(eq(targetRule.id, id), eq(targetRule.workspaceId, viewer.workspaceId)))
    .returning({ id: targetRule.id });
  if (rows.length === 0) throw new WorkspaceAccessError(404, "Not found");
}

// --- The daily evaluation -----------------------------------------------------------

interface Window {
  period: "DAY" | "WEEK";
  from: string;
  to: string;
}

/** Active owners and admins, and each person's managers (direct or through a group). */
async function alertRecipients(db: Database, workspaceId: string) {
  const [admins, direct, viaGroups] = await Promise.all([
    db
      .select({ userId: membership.userId, email: user.email })
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
      .select({ managerId: managedUser.managerId, userId: managedUser.userId })
      .from(managedUser)
      .where(eq(managedUser.workspaceId, workspaceId)),
    db
      .select({ managerId: managedGroup.managerId, userId: userGroupMember.userId })
      .from(managedGroup)
      .innerJoin(userGroupMember, eq(userGroupMember.groupId, managedGroup.groupId))
      .where(eq(managedGroup.workspaceId, workspaceId)),
  ]);
  const managerIds = [...new Set([...direct, ...viaGroups].map((r) => r.managerId))];
  const managers = managerIds.length
    ? await db
        .select({ userId: membership.userId, email: user.email })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(
          and(
            eq(membership.workspaceId, workspaceId),
            eq(membership.status, "ACTIVE"),
            eq(membership.role, "manager"),
            inArray(membership.userId, managerIds),
          ),
        )
    : [];
  const managerEmail = new Map(managers.map((m) => [m.userId, m.email]));
  return (personId: string): string[] => {
    const own = [...direct, ...viaGroups]
      .filter((r) => r.userId === personId && r.managerId !== personId)
      .flatMap((r) => {
        const email = managerEmail.get(r.managerId);
        return email ? [email] : [];
      });
    return [...new Set([...admins.map((a) => a.email), ...own])];
  };
}

/** The windows to evaluate today: yesterday for DAY rules, last week on a week's first day. */
function windowsFor(zone: WorkspaceZone, now: Date): Window[] {
  const today = localDateKey(now, zone.timezone);
  const yesterday = addDaysToKey(today, -1);
  const windows: Window[] = [{ period: "DAY", from: yesterday, to: yesterday }];
  if (weekdayOfKey(today) === zone.weekStart) {
    windows.push({ period: "WEEK", from: addDaysToKey(today, -7), to: yesterday });
  }
  return windows;
}

/** Sends the target emails due for one workspace today; returns how many were queued. */
export async function evaluateTargets(
  db: Database,
  zone: WorkspaceZone,
  now: Date,
): Promise<number> {
  const rules: TargetRule[] = (await rulesOf(db, zone.id)).filter((r) => r.active);
  const windows = windowsFor(zone, now).filter((w) => rules.some((r) => r.period === w.period));
  if (windows.length === 0) return 0;
  const people = [...(await peopleContext(db, zone)).values()];
  if (people.length === 0) return 0;
  const from = windows.reduce((m, w) => (w.from < m ? w.from : m), windows[0]!.from);
  const to = windows[0]!.to;
  const userIds = people.map((p) => p.userId);

  // Everyone's own days lie within a day of the workspace's.
  const bounds = {
    from: zonedDateTimeToInstant(
      { date: addDaysToKey(from, -1), hours: 0, minutes: 0 },
      zone.timezone,
    ),
    to: zonedDateTimeToInstant({ date: addDaysToKey(to, 2), hours: 0, minutes: 0 }, zone.timezone),
  };
  const [work, approved, muted, recipients] = await Promise.all([
    workByPersonDay(db, zone.id, zone.timezone, userIds, bounds),
    db
      .select({
        userId: timeOffRequest.userId,
        unit: timeOffPolicy.unit,
        start: timeOffRequest.startDate,
        end: timeOffRequest.endDate,
        halfDay: timeOffRequest.halfDay,
        minutes: timeOffRequest.minutes,
      })
      .from(timeOffRequest)
      .innerJoin(timeOffPolicy, eq(timeOffPolicy.id, timeOffRequest.policyId))
      .where(
        and(
          eq(timeOffRequest.workspaceId, zone.id),
          eq(timeOffRequest.status, "APPROVED"),
          lte(timeOffRequest.startDate, to),
          gte(timeOffRequest.endDate, from),
        ),
      ),
    db
      .select({ userId: userSettings.userId })
      .from(userSettings)
      .where(
        and(inArray(userSettings.userId, userIds), eq(userSettings.muteTargetReminders, true)),
      ),
    alertRecipients(db, zone.id),
  ]);
  const rulesFrom = approved.reduce((m, r) => (r.start < m ? r.start : m), from);
  const rulesTo = approved.reduce((m, r) => (r.end > m ? r.end : m), to);
  const holidays = await holidayRules(db, zone.id, rulesFrom, rulesTo);
  const mutedIds = new Set(muted.map((m) => m.userId));
  const already = new Set(
    (
      await db
        .select({ kind: emailOutbox.kind, to: emailOutbox.toAddress })
        .from(emailOutbox)
        .where(and(eq(emailOutbox.workspaceId, zone.id), like(emailOutbox.kind, "target:%")))
    ).map((r) => `${r.kind}|${r.to.toLowerCase()}`),
  );

  /** The person's working day: not a non-working weekday, a holiday or a full day off. */
  const counts = (person: PersonContext, dateKey: string) => {
    if (!person.capacity.workingDays.includes(weekdayOfKey(dateKey))) return false;
    if (holidayKeysFor(holidays, person, dateKey, dateKey).has(dateKey)) return false;
    const off = approved
      .filter((r) => r.userId === person.userId && r.start <= dateKey && r.end >= dateKey)
      .reduce((n, r) => {
        const keys = holidayKeysFor(holidays, person, r.start, r.end);
        return n + (timeOffMinutesByDay(r.unit, r, person.capacity, keys).get(dateKey) ?? 0);
      }, 0);
    return off < person.capacity.dailyMinutes;
  };

  let sent = 0;
  for (const window of windows) {
    for (const person of people) {
      for (const rule of rules.filter((r) => r.period === window.period)) {
        if (!targetApplies(rule, person)) continue;
        if (window.period === "DAY" && !counts(person, window.from)) continue;
        const seconds = work
          .filter(
            (w) => w.userId === person.userId && w.dateKey >= window.from && w.dateKey <= window.to,
          )
          .reduce((n, w) => n + w.workSeconds, 0);
        if (!targetBreached(rule, seconds)) continue;
        const kind = `target:${rule.id}:${person.userId}:${window.from}`;
        const base = {
          appUrl: env().APP_URL,
          slug: zone.slug,
          workspaceName: zone.name,
          period: window.period,
          dateKey: window.from,
          endKey: window.to,
          workSeconds: seconds,
          thresholdMinutes: rule.thresholdMinutes,
        };
        const to =
          rule.kind === "UNDER"
            ? mutedIds.has(person.userId)
              ? []
              : [person.email]
            : recipients(person.userId).filter(
                (e) => e.toLowerCase() !== person.email.toLowerCase(),
              );
        const content =
          rule.kind === "UNDER"
            ? underTargetEmail(base)
            : overTargetEmail({ ...base, personName: person.name, userId: person.userId });
        for (const address of to) {
          const key = `${kind}|${address.toLowerCase()}`;
          if (isUndeliverable(address) || already.has(key)) continue;
          already.add(key);
          await enqueueEmail(db, { workspaceId: zone.id, to: address, kind, ...content });
          sent++;
        }
      }
    }
  }
  return sent;
}
