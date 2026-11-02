import "server-only";

import { type Capacity, localDateKey } from "@timekeep/core";
import {
  and,
  type DbExecutor,
  eq,
  inArray,
  membership,
  user,
  userGroupMember,
  workspace,
  workspaceSettings,
} from "@timekeep/db";

import { WorkspaceAccessError } from "../access-error";

/** The workspace facts time off and attendance need: its zone, week start and names. */
export interface WorkspaceZone {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  weekStart: number;
}

export async function workspaceZone(db: DbExecutor, workspaceId: string): Promise<WorkspaceZone> {
  const [row] = await db
    .select({
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      timezone: workspaceSettings.timezone,
      weekStart: workspaceSettings.weekStart,
    })
    .from(workspace)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(eq(workspace.id, workspaceId));
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  return { ...row, timezone: row.timezone ?? "UTC" };
}

/** One person in a workspace: capacity, groups, join date and their own timezone. */
export interface PersonContext {
  userId: string;
  name: string;
  email: string;
  capacity: Capacity;
  groupIds: Set<string>;
  /** The join date in the workspace timezone. */
  joinedOn: string;
  /** `user.timezone`, else the workspace's (decision 13: each person's own days). */
  timezone: string;
}

/** Active members only; anyone else is simply absent from the map. */
export async function peopleContext(
  db: DbExecutor,
  zone: WorkspaceZone,
  userIds?: readonly string[],
): Promise<Map<string, PersonContext>> {
  if (userIds && userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: membership.userId,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      createdAt: membership.createdAt,
      dailyMinutes: membership.dailyCapacityMinutes,
      weeklyMinutes: membership.weeklyCapacityMinutes,
      workingDays: membership.workingDays,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.workspaceId, zone.id),
        eq(membership.status, "ACTIVE"),
        userIds ? inArray(membership.userId, [...userIds]) : undefined,
      ),
    );
  const groups = rows.length
    ? await db
        .select({ userId: userGroupMember.userId, groupId: userGroupMember.groupId })
        .from(userGroupMember)
        .where(
          inArray(
            userGroupMember.userId,
            rows.map((r) => r.userId),
          ),
        )
    : [];
  const out = new Map<string, PersonContext>();
  for (const r of rows) {
    out.set(r.userId, {
      userId: r.userId,
      name: r.name,
      email: r.email,
      capacity: {
        dailyMinutes: r.dailyMinutes,
        weeklyMinutes: r.weeklyMinutes,
        workingDays: r.workingDays,
      },
      groupIds: new Set(groups.filter((g) => g.userId === r.userId).map((g) => g.groupId)),
      joinedOn: localDateKey(r.createdAt, zone.timezone),
      timezone: r.timezone ?? zone.timezone,
    });
  }
  return out;
}

export async function personContext(
  db: DbExecutor,
  zone: WorkspaceZone,
  userId: string,
): Promise<PersonContext> {
  const person = (await peopleContext(db, zone, [userId])).get(userId);
  if (!person) throw new WorkspaceAccessError(404, "Not found");
  return person;
}
