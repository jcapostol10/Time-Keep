import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { type KioskInput, planAllows } from "@timekeep/core";
import type { SQL, SQLWrapper } from "drizzle-orm";
import {
  and,
  asc,
  type Database,
  type DbExecutor,
  eq,
  inArray,
  kiosk,
  kioskAssignee,
  project,
  sql,
  task,
  userGroupMember,
} from "@timekeep/db";

import type { CreatedKiosk, KioskDTO } from "@/lib/kiosk-types";

import { WorkspaceAccessError } from "../access-error";
import { assertCan } from "../authz";
import { CatalogError } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { env } from "../env";
import { assertPeopleAndGroups, assigneeDiff } from "../time-off/policies";

/**
 * Kiosks (Phase 5c, decision 15): admin CRUD and the device token. The URL
 * carries 32 random bytes; only their sha256 is stored, so the URL is shown
 * once, at create and after Rotate (ruling R1).
 */

export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function kioskUrl(token: string): string {
  return `${env().APP_URL}/kiosk/${token}`;
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashKioskToken(token) };
}

/**
 * The kiosk allows the person: everyone, or one of its assignee rows names
 * them or a group they are in. Either argument is a column or a value.
 */
export function kioskAllows(kioskId: SQLWrapper | string, userId: SQLWrapper | string): SQL {
  return sql`exists (select 1 from ${kiosk} k where k.id = ${kioskId} and (k.everyone or exists (
    select 1 from ${kioskAssignee} a where a.kiosk_id = k.id and (a.user_id = ${userId}
      or a.group_id in (select ${userGroupMember.groupId} from ${userGroupMember} where ${userGroupMember.userId} = ${userId})))))`;
}

type KioskRow = typeof kiosk.$inferSelect;

function toDTO(k: KioskRow, assignees: { userId: string | null; groupId: string | null }[]) {
  return {
    id: k.id,
    name: k.name,
    projectId: k.projectId,
    taskId: k.taskId,
    everyone: k.everyone,
    userIds: assignees.flatMap((a) => (a.userId ? [a.userId] : [])),
    groupIds: assignees.flatMap((a) => (a.groupId ? [a.groupId] : [])),
    sessionTimeoutSeconds: k.sessionTimeoutSeconds,
    showLogo: k.showLogo,
    photo: k.photo,
    disabled: k.disabledAt !== null,
    createdAt: k.createdAt.toISOString(),
  } satisfies KioskDTO;
}

async function assigneesOf(db: DbExecutor, kioskIds: string[]) {
  const rows = kioskIds.length
    ? await db
        .select({
          kioskId: kioskAssignee.kioskId,
          userId: kioskAssignee.userId,
          groupId: kioskAssignee.groupId,
        })
        .from(kioskAssignee)
        .where(inArray(kioskAssignee.kioskId, kioskIds))
    : [];
  const byKiosk = new Map<string, typeof rows>();
  for (const r of rows) byKiosk.set(r.kioskId, [...(byKiosk.get(r.kioskId) ?? []), r]);
  return byKiosk;
}

async function loadKiosk(db: DbExecutor, workspaceId: string, id: string): Promise<KioskRow> {
  const [k] = await db
    .select()
    .from(kiosk)
    .where(and(eq(kiosk.id, id), eq(kiosk.workspaceId, workspaceId)));
  if (!k) throw new WorkspaceAccessError(404, "Not found");
  return k;
}

async function kioskDTO(db: DbExecutor, k: KioskRow): Promise<KioskDTO> {
  return toDTO(k, (await assigneesOf(db, [k.id])).get(k.id) ?? []);
}

/** The defaults are this workspace's: the project, and the task in that project. */
async function assertDefaults(db: DbExecutor, workspaceId: string, input: KioskInput) {
  if (input.projectId) {
    const [p] = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.id, input.projectId),
          eq(project.workspaceId, workspaceId),
          eq(project.isTemplate, false),
        ),
      );
    if (!p) throw new CatalogError("INVALID", "Pick a project from this workspace.");
  }
  if (input.taskId) {
    const [t] = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.id, input.taskId),
          eq(task.workspaceId, workspaceId),
          eq(task.projectId, input.projectId ?? ""),
        ),
      );
    if (!t) throw new CatalogError("INVALID", "Pick a task of the kiosk's project.");
  }
  if (!input.everyone) {
    await assertPeopleAndGroups(db, workspaceId, input.userIds, input.groupIds);
  }
}

async function replaceAssignees(tx: DbExecutor, kioskId: string, input: KioskInput) {
  const want = input.everyone ? { userIds: [], groupIds: [] } : input;
  const t = kioskAssignee;
  const current = await tx
    .select({ id: t.id, userId: t.userId, groupId: t.groupId })
    .from(t)
    .where(eq(t.kioskId, kioskId));
  const { dropIds, add } = assigneeDiff(current, want);
  if (dropIds.length) await tx.delete(t).where(inArray(t.id, dropIds));
  if (add.length) await tx.insert(t).values(add.map((a) => ({ id: randomUUID(), kioskId, ...a })));
}

function settingsOf(viewer: Viewer, input: KioskInput) {
  return {
    name: input.name,
    projectId: input.projectId,
    taskId: input.taskId,
    everyone: input.everyone,
    sessionTimeoutSeconds: input.sessionTimeoutSeconds,
    showLogo: input.showLogo,
    // Decision 19: a Pro option; planAllows is the gate (always true until Phase 8).
    photo: input.photo && planAllows({ id: viewer.workspaceId }, "kioskPhoto"),
  };
}

export async function listKiosks(db: Database, viewer: Viewer): Promise<KioskDTO[]> {
  assertCan(viewer.actor, "kiosk.manage", { kind: "none" });
  const rows = await db
    .select()
    .from(kiosk)
    .where(eq(kiosk.workspaceId, viewer.workspaceId))
    .orderBy(asc(kiosk.name), asc(kiosk.createdAt));
  const assignees = await assigneesOf(
    db,
    rows.map((k) => k.id),
  );
  return rows.map((k) => toDTO(k, assignees.get(k.id) ?? []));
}

export async function createKiosk(
  db: Database,
  viewer: Viewer,
  input: KioskInput,
  now = new Date(),
): Promise<CreatedKiosk> {
  assertCan(viewer.actor, "kiosk.manage", { kind: "none" });
  const { token, hash } = newToken();
  const id = randomUUID();
  const row = await db.transaction(async (tx) => {
    await assertDefaults(tx, viewer.workspaceId, input);
    const [k] = await tx
      .insert(kiosk)
      .values({
        id,
        workspaceId: viewer.workspaceId,
        tokenHash: hash,
        tokenRotatedAt: now,
        createdBy: viewer.userId,
        ...settingsOf(viewer, input),
      })
      .returning();
    if (!k) throw new Error("kiosk insert returned nothing");
    await replaceAssignees(tx, id, input);
    return k;
  });
  return { kiosk: await kioskDTO(db, row), url: kioskUrl(token) };
}

export async function updateKiosk(
  db: Database,
  viewer: Viewer,
  id: string,
  input: KioskInput,
): Promise<KioskDTO> {
  assertCan(viewer.actor, "kiosk.manage", { kind: "none" });
  const row = await db.transaction(async (tx) => {
    await loadKiosk(tx, viewer.workspaceId, id);
    await assertDefaults(tx, viewer.workspaceId, input);
    const [k] = await tx
      .update(kiosk)
      .set({ ...settingsOf(viewer, input), updatedAt: new Date() })
      .where(eq(kiosk.id, id))
      .returning();
    if (!k) throw new WorkspaceAccessError(404, "Not found");
    await replaceAssignees(tx, id, input);
    return k;
  });
  return kioskDTO(db, row);
}

/** A new device URL; the old one, and every ticket issued under it, stop working. */
export async function rotateKioskToken(
  db: Database,
  viewer: Viewer,
  id: string,
  now = new Date(),
): Promise<{ url: string }> {
  assertCan(viewer.actor, "kiosk.manage", { kind: "none" });
  await loadKiosk(db, viewer.workspaceId, id);
  const { token, hash } = newToken();
  await db
    .update(kiosk)
    .set({ tokenHash: hash, tokenRotatedAt: now, updatedAt: now })
    .where(eq(kiosk.id, id));
  return { url: kioskUrl(token) };
}

export async function setKioskDisabled(
  db: Database,
  viewer: Viewer,
  id: string,
  disabled: boolean,
  now = new Date(),
): Promise<KioskDTO> {
  assertCan(viewer.actor, "kiosk.manage", { kind: "none" });
  await loadKiosk(db, viewer.workspaceId, id);
  const [k] = await db
    .update(kiosk)
    .set({ disabledAt: disabled ? now : null, updatedAt: now })
    .where(eq(kiosk.id, id))
    .returning();
  if (!k) throw new WorkspaceAccessError(404, "Not found");
  return kioskDTO(db, k);
}
