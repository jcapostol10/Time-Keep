import { z } from "zod";

import {
  COST_LEVELS,
  RATE_APPLY,
  RATE_KINDS,
  RATE_LEVELS,
  type RateKind,
  type RateLevel,
} from "./rates";

import { APPROVAL_PERIODS, APPROVAL_REVIEWERS, LOCK_MODES } from "./approvals";

import { PROJECT_VISIBILITIES, TASK_STATUSES } from "./catalog";
import { hexColorSchema } from "./colors";
import { isCurrencyCode } from "./money";
import { parseDuration } from "./duration";
import { IMPORT_COLUMNS } from "./entry-import";
import { KIOSK_ACTIONS } from "./kiosk";
import { CREATOR_SETTINGS, PAGES, TASK_VISIBILITY } from "./permissions";
import { REQUIRED_FIELDS } from "./required-fields";
import { ROLES } from "./roles";
import { ROUNDING_MODES, ROUNDING_STEPS } from "./rounding";
import { TARGET_KINDS, TARGET_PERIODS } from "./targets";
import { parseCenti, TIME_OFF_ACCRUALS, TIME_OFF_UNITS, type Capacity } from "./time-off";

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
  .regex(/^[A-Z]{3}$/, "Currency must be uppercase letters, e.g. USD or PHP")
  .refine(isCurrencyCode, { message: "Unknown currency code" });

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
  // Phase 4b rules; every field is required so a form never resets one it did not show.
  roundingMode: z.enum(ROUNDING_MODES),
  roundingMinutes: z.literal([...ROUNDING_STEPS]),
  hiddenPages: z.array(z.enum(PAGES)).max(PAGES.length),
  membersSeeTeamTime: z.boolean(),
  projectCreators: z.enum(CREATOR_SETTINGS),
  clientCreators: z.enum(CREATOR_SETTINGS),
  tagCreators: z.enum(CREATOR_SETTINGS),
  requiredFields: z.array(z.enum(REQUIRED_FIELDS)).max(REQUIRED_FIELDS.length),
  forceTimer: z.boolean(),
  allowBreaks: z.boolean(),
  // Tasks by group (decision 11). `taskCreators` left the form: tasks are admins' and project managers'.
  taskVisibility: z.enum(TASK_VISIBILITY),
  // Phase 5a: approvals and lock dates. The lock's own check is `lockSettingsCheck`,
  // applied after `.extend` (zod refuses to extend a refined object).
  approvalEnabled: z.boolean(),
  approvalPeriod: z.enum(APPROVAL_PERIODS),
  approvalReviewers: z.enum(APPROVAL_REVIEWERS),
  lockMode: z.enum(LOCK_MODES),
  lockDate: z.iso.date().nullable(),
  lockDays: z.number().int().min(0).max(365).nullable(),
});
export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;

/** Today's behaviour: nothing hidden, admins create, no rules, rounding off. */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsInput = {
  timezone: "UTC",
  weekStart: 1,
  timeFormat: "24h",
  durationFormat: "hh:mm:ss",
  currency: "USD",
  roundingMode: "off",
  roundingMinutes: 15,
  hiddenPages: [],
  membersSeeTeamTime: false,
  projectCreators: "admins",
  clientCreators: "admins",
  tagCreators: "admins",
  requiredFields: [],
  forceTimer: false,
  allowBreaks: false,
  taskVisibility: "EVERYONE",
  approvalEnabled: false,
  approvalPeriod: "WEEKLY",
  approvalReviewers: "ADMINS",
  lockMode: "OFF",
  lockDate: null,
  lockDays: null,
};

/** A fixed lock needs its date, a rolling one its days. */
export function lockSettingsCheck(
  value: Pick<WorkspaceSettingsInput, "lockMode" | "lockDate" | "lockDays">,
  ctx: z.RefinementCtx,
): void {
  if (value.lockMode === "FIXED" && !value.lockDate) {
    ctx.addIssue({ code: "custom", path: ["lockDate"], message: "Pick the lock date" });
  }
  if (value.lockMode === "ROLLING" && value.lockDays === null) {
    ctx.addIssue({ code: "custom", path: ["lockDays"], message: "Enter a number of days" });
  }
}

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

const memberIdSchema = z.string().min(1).max(64);

/** Pasted addresses (any separators) with one role and optional groups for all of them. */
export const inviteMembersSchema = z.object({
  emails: z.string().max(20_000),
  role: roleSchema.exclude(["owner"]).default("member"),
  groupIds: z.array(z.string().min(1).max(64)).max(50).default([]),
});

export const changeRoleSchema = z.object({
  userId: memberIdSchema,
  role: roleSchema.exclude(["owner"]),
});

export const memberStatusSchema = z.object({
  userId: memberIdSchema,
  status: z.enum(["ACTIVE", "DEACTIVATED"]),
});

/** A manager's people, groups and projects, replaced as a whole. */
export const managerScopeSchema = z.object({
  managerId: memberIdSchema,
  userIds: z.array(memberIdSchema).max(500).default([]),
  groupIds: z.array(memberIdSchema).max(100).default([]),
  projectIds: z.array(memberIdSchema).max(500).default([]),
});

export const transferOwnershipSchema = z.object({
  userId: memberIdSchema,
  confirmName: z.string().trim().min(1, "Type the workspace name").max(100),
});

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

/** Why an owner or admin changes submitted time (Phase 5a decision 5); logged with the change. */
export const entryNoteSchema = z.string().trim().min(3, "Say why").max(500);
/** The optional note every entry write accepts. */
export const entryNoteInputSchema = z.object({ note: entryNoteSchema.optional() });

/** A work entry, or a break (decision 6): no project, task, tags, billing or amount. */
export const ENTRY_TYPES = ["work", "break"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const entryDetailsSchema = z.object({
  description: z.string().max(ENTRY_DESCRIPTION_MAX).default(""),
  projectId: z.string().min(1).nullable().default(null),
  taskId: z.string().min(1).nullable().default(null),
  tagIds: z.array(z.string().min(1)).max(50).default([]),
  billable: z.boolean().default(false),
  /** Fixed at creation; an entry's type never changes. */
  type: z.enum(ENTRY_TYPES).default("work"),
});
export type EntryDetails = z.infer<typeof entryDetailsSchema>;

/** A favourite pins work details (Phase 4b); breaks are not pinned. */
export const pinFavoriteSchema = entryDetailsSchema.omit({ type: true });

export const startTimerSchema = entryDetailsSchema.extend({ note: entryNoteSchema.optional() });
export type StartTimerInput = z.infer<typeof startTimerSchema>;

export const stopTimerSchema = z.object({
  entryId: z.string().min(1),
  end: isoInstantSchema.optional(),
});
export type StopTimerInput = z.infer<typeof stopTimerSchema>;

export const createManualEntrySchema = entryDetailsSchema.extend({
  start: isoInstantSchema,
  end: isoInstantSchema,
  /** The person the entry is for (add time for others); the caller by default. */
  userId: z.string().min(1).optional(),
  note: entryNoteSchema.optional(),
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
  note: entryNoteSchema.optional(),
});
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

export const entryIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  note: entryNoteSchema.optional(),
});
export type EntryIdsInput = z.infer<typeof entryIdsSchema>;

/** Bulk edit (Phase 4b): each present key applies to every selected entry. */
export const bulkEntryPatchSchema = z
  .object({
    projectId: z.string().min(1).nullable().optional(),
    taskId: z.string().min(1).nullable().optional(),
    tags: z
      .object({
        mode: z.enum(["add", "replace", "remove"]),
        tagIds: z.array(z.string().min(1)).max(50),
      })
      .optional(),
    billable: z.boolean().optional(),
    description: z.string().max(ENTRY_DESCRIPTION_MAX).optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), "Pick something to change");
export type BulkEntryPatch = z.infer<typeof bulkEntryPatchSchema>;

/** Split (Phase 4b): the instant inside the entry where the second part starts. */
export const splitEntrySchema = z.object({
  at: isoInstantSchema,
  note: entryNoteSchema.optional(),
});

/** Importing entries (Phase 4b): the file's times' zone and format, what may be created, the mapping. */
export const importOptionsSchema = z.object({
  timezone: timeZoneSchema,
  dateFormat: dateFormatSchema,
  createMissing: z.boolean(),
  mapping: z.partialRecord(z.enum(IMPORT_COLUMNS), z.number().int().min(0).max(500)),
  /** The groups a task created by the import belongs to; required when tasks are by group. */
  newTaskGroupIds: z.array(z.string().min(1)).max(100).default([]),
  /** The dry run's fingerprint, for a commit. */
  fingerprint: z.string().length(64).optional(),
  /** Why an owner or admin imports into submitted periods (Phase 5a). */
  note: entryNoteSchema.optional(),
});
export type ImportOptionsInput = z.infer<typeof importOptionsSchema>;

export const bulkUpdateEntriesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  patch: bulkEntryPatchSchema,
  note: entryNoteSchema.optional(),
});

// --- Approvals (Phase 5a) -----------------------------------------------------

export const submitPeriodSchema = z.object({ periodStart: z.iso.date() });

export const reviewRequestsSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(200),
    decision: z.enum(["APPROVE", "REJECT"]),
    note: entryNoteSchema.optional(),
  })
  .refine((v) => v.decision === "APPROVE" || v.note !== undefined, {
    path: ["note"],
    message: "Say what needs fixing",
  });
export type ReviewRequestsInput = z.infer<typeof reviewRequestsSchema>;

export const reopenRequestSchema = z.object({ note: entryNoteSchema });

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
  /** Templates are listed apart from projects (Phase 4b). */
  kind: z.enum(["projects", "templates"]).default("projects"),
  sort: z.enum(["name", "client", "tracked"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

/** "Save as template" and "Start from template" (Phase 4b): a copy of a project. */
export const copyProjectSchema = z.object({
  sourceId: z.string().min(1),
  name: catalogNameSchema,
  clientId: z.string().min(1).nullable().default(null),
  isTemplate: z.boolean().default(false),
  color: hexColorSchema.optional(),
  billable: z.boolean().optional(),
  visibility: z.enum(PROJECT_VISIBILITIES).optional(),
  note: z.string().max(2000).optional(),
});
export type CopyProjectInput = z.infer<typeof copyProjectSchema>;

export const projectMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).max(500),
});

export const deleteProjectSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("delete") }),
  z.object({ mode: z.literal("reassign"), projectId: z.string().min(1).nullable() }),
]);
export type DeleteProjectMode = z.infer<typeof deleteProjectSchema>;

const groupIdsSchema = z.array(z.string().min(1)).max(100);

export const taskInputSchema = z.object({
  name: catalogNameSchema,
  /** Kept for the data; the UI no longer edits assignees (decision 11). */
  assigneeIds: z.array(z.string().min(1)).max(100).default([]),
  /** The groups whose members see and track on the task when tasks are by group. */
  groupIds: groupIdsSchema.default([]),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskPatchSchema = z.object({
  name: catalogNameSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeIds: z.array(z.string().min(1)).max(100).optional(),
  groupIds: groupIdsSchema.optional(),
});
export type TaskPatch = z.infer<typeof taskPatchSchema>;

/** The Tasks tab's multi-select: add the groups to, remove them from, or set them on the tasks. */
export const taskGroupsSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(200),
  groupIds: groupIdsSchema,
  mode: z.enum(["add", "remove", "set"]),
});
export type TaskGroupsInput = z.infer<typeof taskGroupsSchema>;

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
  note: entryNoteSchema.optional(),
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
    /** No unsubmitted-period (5a) or under-target (5b) reminder emails. */
    muteTargetReminders: z.boolean(),
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
  muteTargetReminders: false,
};

export const rateKindSchema = z.enum(RATE_KINDS);

/** Cost has two levels (Phase 6a decision 2); billable has all five. */
function costLevelIssue(
  value: { kind: RateKind; level: RateLevel },
  ctx: z.core.$RefinementCtx,
): void {
  if (value.kind === "cost" && !(COST_LEVELS as readonly RateLevel[]).includes(value.level)) {
    ctx.addIssue({
      code: "custom",
      path: ["level"],
      message: "Cost rates are per member or per project member.",
    });
  }
}

/** A rate change from the rate dialog; the server parses the amount with the currency. */
export const setRateSchema = z
  .object({
    kind: rateKindSchema.default("billable"),
    level: z.enum(RATE_LEVELS),
    userId: z.string().min(1).max(64).nullish(),
    projectId: z.string().min(1).max(64).nullish(),
    taskId: z.string().min(1).max(64).nullish(),
    amount: z.string().max(32).nullable(),
    apply: z.enum(RATE_APPLY),
    from: z.iso.date().optional(),
  })
  .superRefine(costLevelIssue);

/** Which rate's history to read. */
export const rateTargetSchema = z
  .object({
    kind: rateKindSchema.default("billable"),
    level: z.enum(RATE_LEVELS),
    userId: z.string().min(1).max(64).nullish(),
    projectId: z.string().min(1).max(64).nullish(),
    taskId: z.string().min(1).max(64).nullish(),
  })
  .superRefine(costLevelIssue);

// --- Time off, holidays, capacity and targets (Phase 5b) ----------------------

const idListSchema = z.array(z.string().min(1).max(64)).max(500).default([]);
const minutesOf = (text: string) => {
  if (text.trim() === "0") return 0;
  const seconds = parseDuration(text);
  return seconds === null ? null : Math.round(seconds / 60);
};

export const timeOffPolicySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    unit: z.enum(TIME_OFF_UNITS),
    accrual: z.enum(TIME_OFF_ACCRUALS),
    /** Days or hours a year, as typed ("15", "7.5"); read by `parseCenti`. */
    allowance: z.string().trim().max(16),
    allowNegative: z.boolean(),
    requiresApproval: z.boolean(),
    everyone: z.boolean(),
    userIds: idListSchema,
    groupIds: idListSchema,
  })
  .superRefine((v, ctx) => {
    if (v.accrual === "NONE" && v.allowance === "") return;
    const centi = parseCenti(v.allowance);
    if (centi === null || centi < 0) {
      ctx.addIssue({ code: "custom", path: ["allowance"], message: "Enter an amount, like 15" });
    }
  });
export type TimeOffPolicyInput = z.infer<typeof timeOffPolicySchema>;

export const timeOffRequestSchema = z.object({
  policyId: z.string().min(1).max(64),
  start: z.iso.date(),
  end: z.iso.date(),
  halfDay: z.boolean().default(false),
  /** HOURS policies: per day for one day, the total for a range ("7.5", "4:30"). */
  hours: z
    .string()
    .trim()
    .max(16)
    .refine((t) => t === "" || (minutesOf(t) ?? 0) > 0, "Enter hours, like 4 or 4:30")
    .optional(),
  note: z.string().trim().max(500).default(""),
});
export type TimeOffRequestInput = z.infer<typeof timeOffRequestSchema>;

/** The minutes of an HOURS request, or null. */
export function requestMinutes(input: Pick<TimeOffRequestInput, "hours">): number | null {
  return input.hours ? minutesOf(input.hours) : null;
}

export const reviewTimeOffSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(200),
    decision: z.enum(["APPROVE", "REJECT"]),
    note: entryNoteSchema.optional(),
  })
  .refine((v) => v.decision === "APPROVE" || v.note !== undefined, {
    path: ["note"],
    message: "Say why",
  });
export type ReviewTimeOffInput = z.infer<typeof reviewTimeOffSchema>;

export const cancelTimeOffSchema = z.object({ note: entryNoteSchema });

export const adjustmentSchema = z.object({
  policyId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  /** Signed days or hours ("-2", "1.5"). */
  amount: z
    .string()
    .trim()
    .refine((t) => {
      const c = parseCenti(t);
      return c !== null && c !== 0;
    }, "Enter an amount, like 2 or -1.5"),
  note: z.string().trim().min(3, "Say why").max(500),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const holidaySchema = z.object({
  date: z.iso.date(),
  name: z.string().trim().min(1, "Name is required").max(100),
  repeatsYearly: z.boolean().default(false),
  userIds: idListSchema,
  groupIds: idListSchema,
});
export type HolidayInput = z.infer<typeof holidaySchema>;

export const holidayImportSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  region: z.string().trim().min(1).max(10).nullable(),
  year: z.number().int().min(2000).max(2100),
  rows: z
    .array(
      z.object({
        date: z.iso.date(),
        name: z.string().trim().min(1).max(100),
        estimated: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});
export type HolidayImportInput = z.infer<typeof holidayImportSchema>;

const hoursUpTo = (max: number) =>
  z
    .string()
    .trim()
    .refine((t) => {
      const m = minutesOf(t);
      return m !== null && m <= max * 60;
    }, `Enter hours from 0 to ${max}`);

export const capacitySchema = z.object({
  dailyHours: hoursUpTo(24),
  weeklyHours: hoursUpTo(168),
  workingDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine((days) => new Set(days).size === days.length, "Pick each day once"),
});
export type CapacityInput = z.infer<typeof capacitySchema>;

export function capacityFromInput(input: CapacityInput): Capacity {
  return {
    dailyMinutes: minutesOf(input.dailyHours) ?? 0,
    weeklyMinutes: minutesOf(input.weeklyHours) ?? 0,
    workingDays: [...input.workingDays].sort((a, b) => a - b),
  };
}

export const targetRuleSchema = z.object({
  kind: z.enum(TARGET_KINDS),
  period: z.enum(TARGET_PERIODS),
  /** Hours, as typed ("8", "7:30"). */
  threshold: z
    .string()
    .trim()
    .refine((t) => {
      const m = minutesOf(t);
      return m !== null && m > 0 && m <= 168 * 60;
    }, "Enter hours, like 8"),
  active: z.boolean().default(true),
  everyone: z.boolean(),
  userIds: idListSchema,
  groupIds: idListSchema,
});
export type TargetRuleInput = z.infer<typeof targetRuleSchema>;

export function thresholdMinutes(input: Pick<TargetRuleInput, "threshold">): number {
  return minutesOf(input.threshold) ?? 0;
}

// --- Kiosks, PINs and limited users (Phase 5c) -------------------------------

export const kioskSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    projectId: z.string().min(1).max(64).nullable(),
    taskId: z.string().min(1).max(64).nullable(),
    everyone: z.boolean(),
    userIds: idListSchema,
    groupIds: idListSchema,
    sessionTimeoutSeconds: z.number().int().min(5).max(300).default(15),
    showLogo: z.boolean().default(true),
    photo: z.boolean().default(false),
  })
  .refine((v) => v.taskId === null || v.projectId !== null, {
    path: ["taskId"],
    message: "Pick the task's project",
  });
export type KioskInput = z.infer<typeof kioskSchema>;

export const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, "A PIN is 4 to 6 digits."),
});

export const limitedUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

export const convertLimitedSchema = z.object({ email: emailSchema });

export const kioskIdentifySchema = z.union([
  z.strictObject({ userId: z.string().min(1).max(64), pin: z.string().max(6) }),
  z.strictObject({ qr: z.string().min(1).max(200) }),
]);
export type KioskIdentifyInput = z.infer<typeof kioskIdentifySchema>;

export const kioskPunchSchema = z.object({
  ticket: z.string().min(1).max(1000),
  action: z.enum(KIOSK_ACTIONS),
});
export type KioskPunchInput = z.infer<typeof kioskPunchSchema>;
