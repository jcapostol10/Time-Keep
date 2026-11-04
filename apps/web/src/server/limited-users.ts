import "server-only";

import { randomUUID } from "node:crypto";

import { LIMITED_EMAIL_TAKEN } from "@timekeep/core";
import { and, type Database, eq, membership, sql, user } from "@timekeep/db";

import { WorkspaceAccessError } from "./access-error";
import { assertCan } from "./authz";
import { CatalogError, isUniqueViolation } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";

/**
 * Limited users (decision 18): kiosk-only members. The `user` row is written
 * here, never through Better Auth, so no personal workspace is made; its
 * address is synthetic and undeliverable, and there is no `account` row, so
 * nobody can sign in as them.
 */

export function limitedEmail(userId: string): string {
  return `limited+${userId}@kiosk.invalid`;
}

export async function createLimitedUser(
  db: Database,
  viewer: Viewer,
  input: { name: string },
): Promise<{ userId: string }> {
  assertCan(viewer.actor, "member.manageLimited", { kind: "none" });
  const userId = randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .insert(user)
      .values({ id: userId, name: input.name, email: limitedEmail(userId), emailVerified: false });
    await tx.insert(membership).values({
      id: randomUUID(),
      workspaceId: viewer.workspaceId,
      userId,
      role: "member",
      limited: true,
    });
  });
  return { userId };
}

/**
 * Gives a limited user a real address in place: the same id keeps their
 * entries, rates, PIN and groups. The caller sends the set-password email.
 */
export async function convertLimitedUser(
  db: Database,
  viewer: Viewer,
  userId: string,
  input: { email: string },
): Promise<{ email: string }> {
  assertCan(viewer.actor, "member.manageLimited", { kind: "none" });
  const email = input.email.trim().toLowerCase();
  try {
    await db.transaction(async (tx) => {
      const [m] = await tx
        .select({ id: membership.id })
        .from(membership)
        .where(
          and(
            eq(membership.workspaceId, viewer.workspaceId),
            eq(membership.userId, userId),
            eq(membership.limited, true),
          ),
        );
      if (!m) throw new WorkspaceAccessError(404, "Not found");
      const [taken] = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${email}`);
      if (taken) throw new CatalogError("INVALID", LIMITED_EMAIL_TAKEN);
      await tx
        .update(user)
        .set({ email, emailVerified: false, updatedAt: new Date() })
        .where(eq(user.id, userId));
      await tx.update(membership).set({ limited: false }).where(eq(membership.id, m.id));
    });
  } catch (error) {
    if (isUniqueViolation(error, "user_email_unique"))
      throw new CatalogError("INVALID", LIMITED_EMAIL_TAKEN);
    throw error;
  }
  return { email };
}
