import { z } from "zod";

import { ROLES } from "./roles";

// --- Enumerations shared by DB, server and UI ---------------------------------

export const TIME_FORMATS = ["12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const DURATION_FORMATS = ["hh:mm:ss", "hh:mm", "decimal"] as const;
export type DurationFormat = (typeof DURATION_FORMATS)[number];

export const DATE_FORMATS = ["MM/dd/yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "dd.MM.yyyy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** 0 = Sunday … 6 = Saturday (JavaScript convention). */
export const WEEK_START_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type WeekStartDay = (typeof WEEK_START_DAYS)[number];

export const WEEKDAY_LABELS: Record<WeekStartDay, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

// --- Primitive validators -------------------------------------------------------

const supportedTimeZones = new Set<string>(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [],
);

export function isValidTimeZone(tz: string): boolean {
  if (tz === "UTC") return true;
  if (supportedTimeZones.size > 0) return supportedTimeZones.has(tz);
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimeZone, { message: "Unknown IANA timezone" });

export const currencyCodeSchema = z
  .string()
  .length(3, "Currency must be a 3-letter ISO 4217 code")
  .regex(/^[A-Z]{3}$/, "Currency must be uppercase letters, e.g. USD or PHP");

export const weekStartSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const roleSchema = z.enum(ROLES);
export const timeFormatSchema = z.enum(TIME_FORMATS);
export const durationFormatSchema = z.enum(DURATION_FORMATS);
export const dateFormatSchema = z.enum(DATE_FORMATS);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

// --- Form / action payloads ------------------------------------------------------

export const workspaceNameSchema = z.string().trim().min(2, "Too short").max(60, "Too long");

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const workspaceSettingsSchema = z.object({
  timezone: timeZoneSchema,
  weekStart: weekStartSchema,
  timeFormat: timeFormatSchema,
  durationFormat: durationFormatSchema,
  currency: currencyCodeSchema,
});
export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsInput = {
  timezone: "UTC",
  weekStart: 1,
  timeFormat: "24h",
  durationFormat: "hh:mm:ss",
  currency: "USD",
};

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  timezone: timeZoneSchema.nullable(),
  dateFormat: dateFormatSchema.nullable(),
  timeFormat: timeFormatSchema.nullable(),
  weekStart: weekStartSchema.nullable(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: roleSchema.exclude(["owner"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: emailSchema,
  password: z.string().min(8, "At least 8 characters").max(128),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
