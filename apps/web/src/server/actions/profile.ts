"use server";

import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  timeZoneSchema,
  updateProfileSchema,
} from "@timekeep/core";
import { eq, getDb, user } from "@timekeep/db";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { getAuth } from "@/server/auth";
import { sendEmail } from "@/server/mail";
import { requireSession } from "@/server/session";
import { deleteObject, objectKeyFromUrl, uploadObject } from "@/server/storage";

const EXTENSIONS: Record<(typeof AVATAR_MIME_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function updateProfileAction(input: unknown): Promise<ActionResult> {
  await requireSession("/account");
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  try {
    await getAuth().api.updateUser({ headers: await headers(), body: parsed.data });
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/**
 * Saves the browser's timezone for users who have none yet (Google sign-up
 * does not capture it). Never overwrites a timezone the user chose.
 */
/**
 * A message to the signed-in person, so they can see that TimeKeep's email
 * reaches them, and so an owner can check a new production sender without
 * creating accounts. Unlike other actions it shows the provider's reason on
 * failure: that reason is the point of the check.
 */
export async function sendTestEmailAction(): Promise<ActionResult> {
  const { user } = await requireSession("/account");
  try {
    await sendEmail({
      to: user.email,
      subject: "TimeKeep test email",
      title: "Email works",
      intro: `This message confirms that TimeKeep can reach you at ${user.email}.`,
      outro: "Sent from Profile settings. Nothing else to do.",
    });
    return ok(undefined);
  } catch (error) {
    console.error("[mail] test email failed", error);
    return fail(`Could not send: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export async function setTimezoneIfUnsetAction(
  timezone: unknown,
): Promise<ActionResult<{ updated: boolean }>> {
  const session = await requireSession();
  const parsed = timeZoneSchema.safeParse(timezone);
  if (!parsed.success) return fromZodError(parsed.error);
  try {
    const row = await getDb().query.user.findFirst({
      where: eq(user.id, session.user.id),
      columns: { timezone: true },
    });
    if (row?.timezone) return ok({ updated: false });
    await getAuth().api.updateUser({ headers: await headers(), body: { timezone: parsed.data } });
    revalidatePath("/", "layout");
    return ok({ updated: true });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** Validates, stores the file in S3 and points the user's `image` at it. */
export async function uploadAvatarAction(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const session = await requireSession("/account");
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return fail("Choose an image to upload.");

  const mime = file.type as (typeof AVATAR_MIME_TYPES)[number];
  if (!AVATAR_MIME_TYPES.includes(mime)) {
    return fail("Use a PNG, JPEG, WebP or GIF image.");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return fail(`Images must be ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB or smaller.`);
  }

  // Sniff the first bytes so a renamed file cannot pretend to be an image.
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeImage(bytes, mime)) return fail("That file does not look like a valid image.");

  try {
    const key = `avatars/${session.user.id}/${nanoid(12)}.${EXTENSIONS[mime]}`;
    const { url } = await uploadObject({ key, body: bytes, contentType: mime });

    const previousKey = objectKeyFromUrl(session.user.image);
    await getAuth().api.updateUser({ headers: await headers(), body: { image: url } });
    if (previousKey) await deleteObject(previousKey).catch(() => undefined);

    revalidatePath("/", "layout");
    return ok({ url });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function removeAvatarAction(): Promise<ActionResult> {
  const session = await requireSession("/account");
  try {
    const previousKey = objectKeyFromUrl(session.user.image);
    await getAuth().api.updateUser({ headers: await headers(), body: { image: null } });
    if (previousKey) await deleteObject(previousKey).catch(() => undefined);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

function looksLikeImage(bytes: Uint8Array, mime: string): boolean {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (mime) {
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith([0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return startsWith([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45;
    default:
      return false;
  }
}
