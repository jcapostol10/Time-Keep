import "server-only";

import {
  DEFAULT_TRACKER_SETTINGS,
  testEmailAllowance,
  type TrackerSettingsInput,
  WEEK_START_DAYS,
  type WeekStartDay,
} from "@timekeep/core";
import { type Database, eq, type UserSettings, userSettings } from "@timekeep/db";

function toSettings(row: UserSettings): TrackerSettingsInput {
  return {
    idleDetectionMinutes: row.idleDetectionMinutes,
    pomodoroEnabled: row.pomodoroEnabled,
    pomodoroFocusMinutes: row.pomodoroFocusMinutes,
    pomodoroBreakMinutes: row.pomodoroBreakMinutes,
    remindersEnabled: row.remindersEnabled,
    reminderDays: row.reminderDays.filter((d): d is WeekStartDay =>
      (WEEK_START_DAYS as readonly number[]).includes(d),
    ),
    reminderStartMinutes: row.reminderStartMinutes,
    reminderEndMinutes: row.reminderEndMinutes,
  };
}

/** Tracker preferences for a user; the defaults until they save once. */
export async function getTrackerSettings(
  db: Database,
  userId: string,
): Promise<TrackerSettingsInput> {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  return row
    ? toSettings(row)
    : { ...DEFAULT_TRACKER_SETTINGS, reminderDays: [...DEFAULT_TRACKER_SETTINGS.reminderDays] };
}

export async function upsertTrackerSettings(
  db: Database,
  userId: string,
  input: TrackerSettingsInput,
): Promise<TrackerSettingsInput> {
  const values = {
    idleDetectionMinutes: input.idleDetectionMinutes,
    pomodoroEnabled: input.pomodoroEnabled,
    pomodoroFocusMinutes: input.pomodoroFocusMinutes,
    pomodoroBreakMinutes: input.pomodoroBreakMinutes,
    remindersEnabled: input.remindersEnabled,
    reminderDays: [...input.reminderDays],
    reminderStartMinutes: input.reminderStartMinutes,
    reminderEndMinutes: input.reminderEndMinutes,
  };
  const [row] = await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...values, updatedAt: new Date() } })
    .returning();
  if (!row) throw new Error("Settings could not be saved");
  return toSettings(row);
}

/**
 * Records a test email if the person may send one now, else says why not.
 * The limit lives in the database: serverless instances share no memory.
 */
export async function recordTestEmail(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
    columns: { testEmailSentAt: true, testEmailCount: true },
  });
  const verdict = testEmailAllowance({
    lastSentAt: row?.testEmailSentAt ?? null,
    countInDay: row?.testEmailCount ?? 0,
    now,
  });
  if (!verdict.allowed) return verdict;
  const stamp = { testEmailSentAt: now, testEmailCount: verdict.countInDay };
  await db
    .insert(userSettings)
    .values({ userId, ...stamp })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...stamp, updatedAt: now } });
  return { allowed: true };
}
