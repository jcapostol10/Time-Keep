"use server";

import { setRateSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { retryRateRecalc, runRateRecalcJob } from "@/server/rate-recalc";
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
    const jobId = result.jobId;
    if (jobId) after(() => runRateRecalcJob(getDb(), jobId));
    revalidatePath(`/w/${slug}`, "layout");
    return ok(result);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** A failed "apply to past entries" job resumes from where it stopped. */
export async function retryRateRecalcAction(slug: string, jobId: string): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "rate.recalculate");
    await retryRateRecalc(getDb(), viewer, jobId);
    after(() => runRateRecalcJob(getDb(), jobId));
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
