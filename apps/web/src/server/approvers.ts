import "server-only";

import { type Action, can, isUndeliverable, type Resource } from "@timekeep/core";
import { and, type Database, eq, inArray, membership, ne, user } from "@timekeep/db";

import { loadViewer } from "./authz";

/**
 * Active owners, admins and managers the approvers setting lets review a
 * person's period (`approval.review`, with its projects) or time off
 * (`timeOff.review`, with no projects: ruling R3). Undeliverable addresses
 * are left out.
 */
export async function approversFor(
  db: Database,
  workspaceId: string,
  request: { userId: string; projectIds: string[] },
  action: Extract<Action, "approval.review" | "timeOff.review"> = "approval.review",
): Promise<{ userId: string; email: string; name: string }[]> {
  const candidates = await db
    .select({
      userId: membership.userId,
      role: membership.role,
      email: user.email,
      name: user.name,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.workspaceId, workspaceId),
        eq(membership.status, "ACTIVE"),
        inArray(membership.role, ["owner", "admin", "manager"]),
        ne(membership.userId, request.userId),
      ),
    );
  const out: { userId: string; email: string; name: string }[] = [];
  for (const c of candidates) {
    if (isUndeliverable(c.email)) continue;
    if (c.role !== "owner" && c.role !== "admin") {
      const { actor } = await loadViewer(db, workspaceId, c.userId);
      const resource: Resource = {
        kind: "approval",
        userId: request.userId,
        projectIds: request.projectIds,
      };
      if (!can(actor, action, resource)) continue;
    }
    out.push({ userId: c.userId, email: c.email, name: c.name });
  }
  return out;
}
