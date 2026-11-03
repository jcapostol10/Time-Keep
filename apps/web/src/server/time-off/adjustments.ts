import "server-only";

import { randomUUID } from "node:crypto";

import { type AdjustmentInput, parseCenti } from "@timekeep/core";
import { and, type Database, eq, membership, timeOffAdjustment } from "@timekeep/db";

import { WorkspaceAccessError } from "../access-error";
import { assertCan } from "../authz";
import type { Viewer } from "../catalog/viewer";
import { loadPolicy } from "./policies";

/** A signed change to someone's balance, dated `today` (the workspace's local date). */
export async function addAdjustment(
  db: Database,
  viewer: Viewer,
  input: AdjustmentInput,
  today: string,
): Promise<void> {
  assertCan(viewer.actor, "timeOff.manage", { kind: "none" });
  await loadPolicy(db, viewer.workspaceId, input.policyId);
  const [member] = await db
    .select({ id: membership.id })
    .from(membership)
    .where(
      and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, input.userId)),
    );
  if (!member) throw new WorkspaceAccessError(404, "Not found");
  await db.insert(timeOffAdjustment).values({
    id: randomUUID(),
    workspaceId: viewer.workspaceId,
    userId: input.userId,
    policyId: input.policyId,
    amountCenti: parseCenti(input.amount) ?? 0,
    effectiveOn: today,
    note: input.note,
    createdBy: viewer.userId,
  });
}
