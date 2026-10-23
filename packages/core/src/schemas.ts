import { z } from "zod";

import { PROJECT_VISIBILITIES, TASK_STATUSES } from "./catalog";
import { hexColorSchema } from "./colors";
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

// --- Time tracker ----------------------------------------------------------------

export const ENTRY_DESCRIPTION_MAX = 3000;

/** ISO 8601 instant (with offset or Z) → Date. Every action/route payload uses this. */
export const isoInstantSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const entryDetailsSchema = z.object({
  description: z.string().max(ENTRY_DESCRIPTION_MAX).default(""),
  projectId: z.string().min(1).nullable().default(null),
  /** Carried for Phase 2; no task picker exists yet. */
  taskId: z.string().min(1).nullable().default(null),
  tagIds: z.array(z.string().min(1)).max(50).default([]),
  billable: z.boolean().default(false),
});
export type EntryDetails = z.infer<typeof entryDetailsSchema>;

export const startTimerSchema = entryDetailsSchema;
export type StartTimerInput = z.infer<typeof startTimerSchema>;

export const stopTimerSchema = z.object({
  entryId: z.string().min(1),
  end: isoInstantSchema.optional(),
});
export type StopTimerInput = z.infer<typeof stopTimerSchema>;

export const createManualEntrySchema = entryDetailsSchema.extend({
  start: isoInstantSchema,
  end: isoInstantSchema,
});
export type CreateManualEntryInput = z.infer<typeof createManualEntrySchema>;

/** Partial patch; absent keys are left untouched. */
export const updateEntrySchema = z.object({
  description: z.string().max(ENTRY_DESCRIPTION_MAX).optional(),
  projectId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(50).optional(),
  billable: z.boolean().optional(),
  start: isoInstantSchema.optional(),
  end: isoInstantSchema.optional(),
});
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

export const entryIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});
export type EntryIdsInput = z.infer<typeof entryIdsSchema>;

// --- Catalog: clients, projects, tasks, tags ----------------------------------

const catalogNameSchema = z.string().trim().min(1, "Name is required").max(100);

export const clientInputSchema = z.object({
  name: catalogNameSchema,
  address: z.string().trim().max(500).default(""),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).default(""),
  notes: z.string().trim().max(2000).default(""),
  /** Reserved for invoicing (Phase 6). */
  currency: currencyCodeSchema.nullable().default(null),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

/** Only the keys given are written; see projectPatchSchema. */
export const clientPatchSchema = z.object({
  name: catalogNameSchema.optional(),
  address: z.string().trim().max(500).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  notes: z.string().trim().max(2000).optional(),
  currency: currencyCodeSchema.nullable().optional(),
  archived: z.boolean().optional(),
});
export type ClientPatch = z.infer<typeof clientPatchSchema>;

export const projectInputSchema = z.object({
  name: catalogNameSchema,
  clientId: z.string().min(1).nullable().default(null),
  color: hexColorSchema.optional(),
  billable: z.boolean().default(true),
  visibility: z.enum(PROJECT_VISIBILITIES).default("PUBLIC"),
  note: z.string().trim().max(2000).default(""),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

/** Only the keys given are written; no field defaults, or a patch would reset the rest. */
export const projectPatchSchema = z.object({
  name: catalogNameSchema.optional(),
  clientId: z.string().min(1).nullable().optional(),
  color: hexColorSchema.optional(),
  billable: z.boolean().optional(),
  visibility: z.enum(PROJECT_VISIBILITIES).optional(),
  note: z.string().trim().max(2000).optional(),
  archived: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
});
export type ProjectPatch = z.infer<typeof projectPatchSchema>;

export const projectListQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  clientId: z.string().min(1).optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
  billing: z.enum(["all", "billable", "non-billable"]).default("all"),
  access: z.enum(["all", "public", "private"]).default("all"),
  sort: z.enum(["name", "client", "tracked"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).max(500),
});

export const deleteProjectSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("delete") }),
  z.object({ mode: z.literal("reassign"), projectId: z.string().min(1).nullable() }),
]);
export type DeleteProjectMode = z.infer<typeof deleteProjectSchema>;

export const taskInputSchema = z.object({
  name: catalogNameSchema,
  assigneeIds: z.array(z.string().min(1)).max(100).default([]),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskPatchSchema = z.object({
  name: catalogNameSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeIds: z.array(z.string().min(1)).max(100).optional(),
});
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const tagInputSchema = z.object({
  name: catalogNameSchema,
  color: hexColorSchema.optional(),
});
export type TagInput = z.infer<typeof tagInputSchema>;

export const tagPatchSchema = z.object({
  name: catalogNameSchema.optional(),
  color: hexColorSchema.optional(),
  archived: z.boolean().optional(),
});
export type TagPatch = z.infer<typeof tagPatchSchema>;

export type CreateTagInput = TagInput;

/** A view asks for at most a year at a time; 366 days covers a leap year. */
export const MAX_DATE_RANGE_DAYS = 366;
export const dateRangeSchema = z
  .object({ from: isoInstantSchema, to: isoInstantSchema })
  .refine((r) => r.to.getTime() > r.from.getTime(), {
    message: "The range must end after it starts",
  })
  // A span between two instants, not a date shifted by days, so milliseconds are fine here.
  .refine((r) => r.to.getTime() - r.from.getTime() <= MAX_DATE_RANGE_DAYS * 86_400_000, {
    message: "Pick a range of at most one year.",
  });
export type DateRangeInput = z.infer<typeof dateRangeSchema>;

// --- Timesheet -------------------------------------------------------------------

export const timesheetRowSchema = z.object({
  projectId: z.string().min(1).nullable(),
  taskId: z.string().min(1).nullable(),
  description: z.string().max(ENTRY_DESCRIPTION_MAX).default(""),
});

export const timesheetTemplateInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  rows: z.array(timesheetRowSchema).max(50),
});
export type TimesheetTemplateInput = z.infer<typeof timesheetTemplateInputSchema>;

export const copyWeekSchema = z.object({
  fromWeekStart: isoInstantSchema,
  toWeekStart: isoInstantSchema,
});
export type CopyWeekInput = z.infer<typeof copyWeekSchema>;

export const trackerSettingsSchema = z
  .object({
    /** null = idle detection off */
    idleDetectionMinutes: z.number().int().min(1).max(240).nullable(),
    pomodoroEnabled: z.boolean(),
    pomodoroFocusMinutes: z.number().int().min(1).max(180),
    pomodoroBreakMinutes: z.number().int().min(1).max(60),
    remindersEnabled: z.boolean(),
    /** 0 = Sunday … 6 = Saturday */
    reminderDays: z.array(weekStartSchema).max(7),
    /** Minutes since local midnight. */
    reminderStartMinutes: z.number().int().min(0).max(1439),
    reminderEndMinutes: z.number().int().min(1).max(1440),
  })
  .refine((s) => s.reminderEndMinutes > s.reminderStartMinutes, {
    path: ["reminderEndMinutes"],
    message: "End must be after start",
  });
export type TrackerSettingsInput = z.infer<typeof trackerSettingsSchema>;

export const DEFAULT_IDLE_DETECTION_MINUTES = 15;

export const DEFAULT_TRACKER_SETTINGS: TrackerSettingsInput = {
  idleDetectionMinutes: null,
  pomodoroEnabled: false,
  pomodoroFocusMinutes: 25,
  pomodoroBreakMinutes: 5,
  remindersEnabled: false,
  reminderDays: [1, 2, 3, 4, 5],
  reminderStartMinutes: 9 * 60,
  reminderEndMinutes: 17 * 60,
};
