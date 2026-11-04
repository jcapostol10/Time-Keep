import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { qrPayload } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  eq,
  isNull,
  kiosk,
  kioskCredential,
  membership,
  sql,
  workspace,
} from "@timekeep/db";
import { hashPassword } from "better-auth/crypto";

import type { CredentialStatus } from "@/lib/kiosk-types";

import { WorkspaceAccessError } from "../access-error";
import { assertCan } from "../authz";
import type { Viewer } from "../catalog/viewer";
import { kioskAllows } from "./kiosks";

/**
 * Kiosk PINs and QR codes (decision 16), per (workspace, person). A PIN is
 * hashed with Better Auth's scrypt; a QR code carries 32 random bytes whose
 * sha256 is stored, so showing a code always issues a new one.
 */

export function hashQrToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Whose credential the viewer may set: their own (`pin.setOwn`), or a limited
 * member's for those who manage them. Anyone else is a 404.
 */
async function assertCredentialTarget(db: Database, viewer: Viewer, userId: string) {
  if (userId === viewer.userId) {
    assertCan(viewer.actor, "pin.setOwn", { kind: "person", userId });
    return;
  }
  const [m] = await db
    .select({ limited: membership.limited })
    .from(membership)
    .where(and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, userId)));
  if (!m?.limited) throw new WorkspaceAccessError(404, "Not found");
  assertCan(viewer.actor, "member.manageLimited", { kind: "none" });
}

async function upsertCredential(
  db: Database,
  workspaceId: string,
  userId: string,
  set: Partial<typeof kioskCredential.$inferInsert>,
  now: Date,
) {
  await db
    .insert(kioskCredential)
    .values({ id: randomUUID(), workspaceId, userId, ...set })
    .onConflictDoUpdate({
      target: [kioskCredential.workspaceId, kioskCredential.userId],
      set: { ...set, updatedAt: now },
    });
}

export async function setPin(
  db: Database,
  viewer: Viewer,
  userId: string,
  pin: string,
  now = new Date(),
): Promise<void> {
  await assertCredentialTarget(db, viewer, userId);
  const pinHash = await hashPassword(pin);
  await upsertCredential(db, viewer.workspaceId, userId, { pinHash, pinSetAt: now }, now);
}

/** A new QR code for the person; printed copies of the old one stop working. */
export async function qrToken(
  db: Database,
  viewer: Viewer,
  userId: string,
  now = new Date(),
): Promise<{ payload: string }> {
  await assertCredentialTarget(db, viewer, userId);
  const token = randomBytes(32).toString("base64url");
  await upsertCredential(
    db,
    viewer.workspaceId,
    userId,
    { qrTokenHash: hashQrToken(token), qrRotatedAt: now },
    now,
  );
  return { payload: qrPayload(token) };
}

/** The person's workspaces with an active kiosk allowing them (ruling R8), by name. */
export async function credentialStatuses(
  db: Database,
  userId: string,
): Promise<CredentialStatus[]> {
  const rows = await db
    .select({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      slug: workspace.slug,
      pinSetAt: kioskCredential.pinSetAt,
      pinHash: kioskCredential.pinHash,
      qrTokenHash: kioskCredential.qrTokenHash,
    })
    .from(membership)
    .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
    .leftJoin(
      kioskCredential,
      and(
        eq(kioskCredential.workspaceId, membership.workspaceId),
        eq(kioskCredential.userId, membership.userId),
      ),
    )
    .where(
      and(
        eq(membership.userId, userId),
        eq(membership.status, "ACTIVE"),
        sql`exists (select 1 from ${kiosk} where ${kiosk.workspaceId} = ${membership.workspaceId}
          and ${isNull(kiosk.disabledAt)} and ${kioskAllows(kiosk.id, membership.userId)})`,
      ),
    )
    .orderBy(asc(workspace.name));
  return rows.map((r) => ({
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    slug: r.slug,
    hasPin: r.pinHash !== null,
    pinSetAt: r.pinSetAt?.toISOString() ?? null,
    hasQr: r.qrTokenHash !== null,
  }));
}
