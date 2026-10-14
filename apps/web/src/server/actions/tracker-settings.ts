"use server";

import { trackerSettingsSchema, type TrackerSettingsInput } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { upsertTrackerSettings } from "@/server/queries/user-settings";
import { requireSession } from "@/server/session";

/** Saves the caller's idle detection, Pomodoro and reminder preferences. */
export async function updateTrackerSettingsAction(
  input: unknown,
): Promise<ActionResult<TrackerSettingsInput>> {
  const session = await requireSession("/account");
  const parsed = trackerSettingsSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  try {
    const saved = await upsertTrackerSettings(getDb(), session.user.id, parsed.data);
    revalidatePath("/", "layout");
    return ok(saved);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Something went wrong.");
  }
}
