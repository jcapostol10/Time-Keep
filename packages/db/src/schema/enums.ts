import { DURATION_FORMATS, MEMBERSHIP_STATUSES, ROLES, TIME_FORMATS } from "@timekeep/core";
import { pgEnum } from "drizzle-orm/pg-core";

export const workspaceRoleEnum = pgEnum("workspace_role", ROLES);
export const membershipStatusEnum = pgEnum("membership_status", MEMBERSHIP_STATUSES);
export const timeFormatEnum = pgEnum("time_format", TIME_FORMATS);
export const durationFormatEnum = pgEnum("duration_format", DURATION_FORMATS);
