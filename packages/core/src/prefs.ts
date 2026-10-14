import {
  DATE_FORMATS,
  type DateFormat,
  DURATION_FORMATS,
  type DurationFormat,
  isValidTimeZone,
  TIME_FORMATS,
  type TimeFormat,
  WEEK_START_DAYS,
  type WeekStartDay,
} from "./schemas";

/** Everything the UI needs to render dates, times and durations for a viewer. */
export interface ViewerPrefs {
  timezone: string;
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  weekStart: WeekStartDay;
  durationFormat: DurationFormat;
}

export interface UserPrefInputs {
  timezone?: string | null;
  timeFormat?: string | null;
  dateFormat?: string | null;
  weekStart?: number | null;
}

export interface WorkspacePrefInputs {
  timezone: string;
  timeFormat: string;
  durationFormat: string;
  weekStart: number;
}

function pick<T extends string | number>(
  allowed: readonly T[],
  ...candidates: (string | number | null | undefined)[]
): T | undefined {
  for (const c of candidates) {
    if (c !== null && c !== undefined && (allowed as readonly (string | number)[]).includes(c)) {
      return c as T;
    }
  }
  return undefined;
}

/**
 * Resolution order per CLAUDE.md invariant 1: `user` → `workspace_settings` →
 * built-in default. Invalid stored values are skipped rather than trusted.
 */
export function resolveViewerPrefs(user: UserPrefInputs, settings: WorkspacePrefInputs): ViewerPrefs {
  const timezone =
    [user.timezone, settings.timezone].find((tz): tz is string => !!tz && isValidTimeZone(tz)) ??
    "UTC";
  return {
    timezone,
    timeFormat: pick(TIME_FORMATS, user.timeFormat, settings.timeFormat) ?? "24h",
    dateFormat: pick(DATE_FORMATS, user.dateFormat) ?? "MM/dd/yyyy",
    weekStart: pick(WEEK_START_DAYS, user.weekStart, settings.weekStart) ?? 1,
    durationFormat: pick(DURATION_FORMATS, settings.durationFormat) ?? "hh:mm:ss",
  };
}
