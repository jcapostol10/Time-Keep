import { inArray, like, lt, sql } from "drizzle-orm";

import type { Database } from "./client";
import { capturedEmail, invitation, membership, user, workspace } from "./schema";

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Removes throwaway e2e data: `@e2e.test` users, workspaces that only e2e
 * users belong to (if any of them is `@e2e.test`), invitations sent to
 * `@e2e.test` addresses, and captured email older than a day. Seeded demo
 * users and the demo workspace are left for the next run.
 */
export async function cleanupE2eData(
  db: Database,
  opts: { now?: Date } = {},
): Promise<{ users: number; workspaces: number; emails: number }> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const workspaceIds = await e2eOnlyWorkspaceIds(tx, {
      withMemberDomain: "@e2e.test",
    });
    if (workspaceIds.length > 0) {
      await tx.delete(workspace).where(inArray(workspace.id, workspaceIds));
    }
    await tx.delete(invitation).where(like(sql`lower(${invitation.email})`, "%@e2e.test"));
    const users = await tx
      .delete(user)
      .where(like(sql`lower(${user.email})`, "%@e2e.test"))
      .returning({ id: user.id });
    const emails = await tx
      .delete(capturedEmail)
      .where(lt(capturedEmail.createdAt, new Date(now.getTime() - ONE_DAY_MS)))
      .returning({ id: capturedEmail.id });
    return { users: users.length, workspaces: workspaceIds.length, emails: emails.length };
  });
}
