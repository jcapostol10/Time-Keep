"use server";

import { kioskSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { CreatedKiosk, KioskDTO } from "@/lib/kiosk-types";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import {
  createKiosk,
  rotateKioskToken,
  setKioskDisabled,
  updateKiosk,
} from "@/server/kiosk/kiosks";
import { requireWorkspaceAccess } from "@/server/workspace-access";

async function kioskViewer(slug: string) {
  return authorize(await requireWorkspaceAccess(slug), "kiosk.manage");
}

export async function createKioskAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<CreatedKiosk>> {
  try {
    const viewer = await kioskViewer(slug);
    const parsed = kioskSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createKiosk(getDb(), viewer, parsed.data);
    revalidatePath(`/w/${slug}/kiosks`);
    return ok(created);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function updateKioskAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<KioskDTO>> {
  try {
    const viewer = await kioskViewer(slug);
    const parsed = kioskSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const kiosk = await updateKiosk(getDb(), viewer, id, parsed.data);
    revalidatePath(`/w/${slug}/kiosks`);
    return ok(kiosk);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function rotateKioskTokenAction(
  slug: string,
  id: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const viewer = await kioskViewer(slug);
    return ok(await rotateKioskToken(getDb(), viewer, id));
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function setKioskDisabledAction(
  slug: string,
  id: string,
  disabled: boolean,
): Promise<ActionResult<KioskDTO>> {
  try {
    const viewer = await kioskViewer(slug);
    const kiosk = await setKioskDisabled(getDb(), viewer, id, disabled === true);
    revalidatePath(`/w/${slug}/kiosks`);
    return ok(kiosk);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
