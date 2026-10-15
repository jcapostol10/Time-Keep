import { and, inArray, like, lt, notInArray, sql } from "drizzle-orm";

import type { Database } from "./client";
import { capturedEmail, membership, user, workspace } from "./schema";

/**
 * e2e data shares the production database with real customers, so it is
 * fenced off by email domain: seeded demo users are `@demo.test`, throwaway
 * test users are `@e2e.test`. A workspace belongs to e2e only when every one
 * of its members is such a user; anything with a real member is a customer
 * workspace and is never deleted by seeding or cleanup.
 */

const E2E_DOMAINS = ["@demo.test", "@e2e.test"] as const;

export function isE2eEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return E2E_DOMAINS.some((d) => e.endsWith(d));
}

const isE2eMember = sql`(lower(${user.email}) like '%@demo.test' or lower(${user.email}) like '%@e2e.test')`;

/**
 * Workspaces whose members are all e2e users. With `withMemberDomain`, only
 * those that also include at least one member on that domain.
 */
export async function e2eOnlyWorkspaceIds(
  db: Pick<Database, "select">,
  opts: { withMemberDomain?: (typeof E2E_DOMAINS)[number] } = {},
): Promise<string[]> {
  const having = opts.withMemberDomain
    ? sql`bool_and(${isE2eMember}) and bool_or(lower(${user.email}) like ${`%${opts.withMemberDomain}`})`
    : sql`bool_and(${isE2eMember})`;
  const rows = await db
    .select({ workspaceId: membership.workspaceId })
    .from(membership)
    .innerJoin(user, sql`${user.id} = ${membership.userId}`)
    .groupBy(membership.workspaceId)
    .having(having);
  return rows.map((r) => r.workspaceId);
}

/**
 * e2e/demo users on `domain` who also belong to a workspace with a real
 * member. Deleting them would cascade into that customer workspace (their
 * time entries, the invitations they sent), so callers must not.
 */
export async function e2eUsersInCustomerWorkspaces(
  db: Pick<Database, "select">,
  domain: (typeof E2E_DOMAINS)[number],
): Promise<{ email: string; workspace: string }[]> {
  const safe = new Set(await e2eOnlyWorkspaceIds(db));
  const rows = await db
    .select({ email: user.email, workspace: workspace.name, workspaceId: workspace.id })
    .from(membership)
    .innerJoin(user, sql`${user.id} = ${membership.userId}`)
    .innerJoin(workspace, sql`${workspace.id} = ${membership.workspaceId}`)
    .where(like(sql`lower(${user.email})`, `%${domain}`));
  return rows
    .filter((r) => !safe.has(r.workspaceId))
    .map((r) => ({ email: r.email, workspace: r.workspace }));
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Removes throwaway e2e data: `@e2e.test` users and the workspaces that only
 * e2e users belong to (if any of them is `@e2e.test`), plus captured email
 * older than a day. An `@e2e.test` user who belongs to a customer workspace is
 * skipped and counted, never deleted, so nothing cascades into customer data.
 * Seeded demo users and the demo workspace are left for the next run.
 */
export async function cleanupE2eData(
  db: Database,
  opts: { now?: Date } = {},
): Promise<{ users: number; workspaces: number; emails: number; skipped: number }> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const blocked = await e2eUsersInCustomerWorkspaces(tx, "@e2e.test");
    const blockedEmails = [...new Set(blocked.map((b) => b.email.toLowerCase()))];
    const workspaceIds = await e2eOnlyWorkspaceIds(tx, { withMemberDomain: "@e2e.test" });
    if (workspaceIds.length > 0) {
      await tx.delete(workspace).where(inArray(workspace.id, workspaceIds));
    }
    const isE2eUser = like(sql`lower(${user.email})`, "%@e2e.test");
    const users = await tx
      .delete(user)
      .where(
        blockedEmails.length > 0
          ? and(isE2eUser, notInArray(sql`lower(${user.email})`, blockedEmails))
          : isE2eUser,
      )
      .returning({ id: user.id });
    const emails = await tx
      .delete(capturedEmail)
      .where(lt(capturedEmail.createdAt, new Date(now.getTime() - ONE_DAY_MS)))
      .returning({ id: capturedEmail.id });
    return {
      users: users.length,
      workspaces: workspaceIds.length,
      emails: emails.length,
      skipped: blockedEmails.length,
    };
  });
}
