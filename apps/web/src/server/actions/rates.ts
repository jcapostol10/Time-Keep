"use server";

import { setRateSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { type RateDTO, setRate } from "@/server/rates";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** A new rate at one level; "Entries from a date" and "All entries" return the job that applies it. */
export async function setRateAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ rate: RateDTO; jobId: string | null }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "rate.set");
    const parsed = setRateSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const result = await setRate(getDb(), viewer, parsed.data);
    revalidatePath(`/w/${slug}`, "layout");
    return ok(result);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
