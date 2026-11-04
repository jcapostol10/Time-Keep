import "server-only";

import { randomUUID } from "node:crypto";

import { can, KIOSK_ATTEMPT_DAYS, KIOSK_PHOTO_DAYS } from "@timekeep/core";
import { and, type Database, eq, inArray, kioskAttempt, kioskPhoto, lt } from "@timekeep/db";

import { WorkspaceAccessError } from "../access-error";
import type { Viewer } from "../catalog/viewer";
import { deleteExport, presignedExportUrl, uploadExport } from "../storage";

/**
 * Clock-in photos (decision 19, ruling R5): one JPEG per entry in the private
 * export bucket, seen by kiosk managers through a 5-minute presigned URL and
 * deleted after 90 days.
 */

export const KIOSK_PHOTO_MAX_BYTES = 1024 * 1024;
const PHOTO_URL_SECONDS = 5 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export class KioskPhotoError extends Error {}

export function photoKey(workspaceId: string, entryId: string): string {
  return `kiosk-photos/${workspaceId}/${entryId}.jpg`;
}

/** A JPEG (FF D8 FF) of at most 1 MiB, or a refusal. */
export function assertKioskPhoto(bytes: Uint8Array): void {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!jpeg || bytes.length > KIOSK_PHOTO_MAX_BYTES) {
    throw new KioskPhotoError("The photo must be a JPEG of at most 1 MB.");
  }
}

export async function savePunchPhoto(
  db: Database,
  input: { workspaceId: string; entryId: string; bytes: Uint8Array },
  now = new Date(),
): Promise<void> {
  assertKioskPhoto(input.bytes);
  const key = photoKey(input.workspaceId, input.entryId);
  await uploadExport({ key, body: input.bytes, contentType: "image/jpeg" });
  await db
    .insert(kioskPhoto)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      entryId: input.entryId,
      objectKey: key,
      takenAt: now,
    })
    .onConflictDoNothing();
}

/** A short-lived link to an entry's photo, for those who manage kiosks; 404 without one. */
export async function kioskPhotoUrl(
  db: Database,
  viewer: Viewer,
  entryId: string,
): Promise<string> {
  // Ruling R6: for anyone else it is the same 404 as an entry without a photo.
  if (!can(viewer.actor, "kiosk.manage", { kind: "none" })) {
    throw new WorkspaceAccessError(404, "Not found");
  }
  const [p] = await db
    .select({ key: kioskPhoto.objectKey })
    .from(kioskPhoto)
    .where(and(eq(kioskPhoto.entryId, entryId), eq(kioskPhoto.workspaceId, viewer.workspaceId)));
  if (!p) throw new WorkspaceAccessError(404, "Not found");
  return presignedExportUrl(p.key, PHOTO_URL_SECONDS, `${entryId}.jpg`, { inline: true });
}

/** Deletes photos older than 90 days (row and object) and attempts older than a day. */
export async function purgeKiosk(
  db: Database,
  now = new Date(),
): Promise<{ photos: number; attempts: number }> {
  const old = await db
    .select({ id: kioskPhoto.id, key: kioskPhoto.objectKey })
    .from(kioskPhoto)
    .where(lt(kioskPhoto.takenAt, new Date(now.getTime() - KIOSK_PHOTO_DAYS * DAY_MS)))
    .limit(1000);
  const gone: string[] = [];
  for (const p of old) {
    try {
      await deleteExport(p.key);
      gone.push(p.id);
    } catch (error) {
      // Kept for the next run.
      console.error("[kiosk] photo delete failed", error);
    }
  }
  if (gone.length) await db.delete(kioskPhoto).where(inArray(kioskPhoto.id, gone));
  const attempts = await db
    .delete(kioskAttempt)
    .where(lt(kioskAttempt.createdAt, new Date(now.getTime() - KIOSK_ATTEMPT_DAYS * DAY_MS)))
    .returning({ id: kioskAttempt.id });
  return { photos: gone.length, attempts: attempts.length };
}
