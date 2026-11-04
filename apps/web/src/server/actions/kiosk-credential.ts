"use server";

import { pinSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { qrToken, setPin } from "@/server/kiosk/credentials";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** The viewer's own kiosk PIN and QR code in one workspace (Profile → Kiosk, ruling R8). */

async function ownViewer(slug: string) {
  const ctx = await requireWorkspaceAccess(slug);
  return authorize(ctx, "pin.setOwn", { kind: "person", userId: ctx.user.id });
}

export async function setOwnPinAction(slug: string, input: unknown): Promise<ActionResult> {
  try {
    const viewer = await ownViewer(slug);
    const parsed = pinSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setPin(getDb(), viewer, viewer.userId, parsed.data.pin);
    revalidatePath("/account");
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** A new personal QR code (only its hash is kept, so showing it always issues one). */
export async function ownQrAction(slug: string): Promise<ActionResult<{ payload: string }>> {
  try {
    const viewer = await ownViewer(slug);
    const result = await qrToken(getDb(), viewer, viewer.userId);
    revalidatePath("/account");
    return ok(result);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
