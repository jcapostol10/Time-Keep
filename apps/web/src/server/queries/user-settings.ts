import "server-only";

import {
  DEFAULT_TRACKER_SETTINGS,
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
