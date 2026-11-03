import type { Balance, TimeOffAccrual, TimeOffStatus, TimeOffUnit } from "@timekeep/core";
// Type only: the dataset itself never reaches a client bundle.
import type { ImportCandidate } from "@timekeep/core/holiday-import";

/** Time off DTOs (Phase 5b): JSON only, dates as `YYYY-MM-DD` keys, instants as ISO strings. */

export interface PolicyDTO {
  id: string;
  name: string;
  unit: TimeOffUnit;
  accrual: TimeOffAccrual;
  allowanceCenti: number;
  allowNegative: boolean;
  requiresApproval: boolean;
  everyone: boolean;
  /** Assignees: listed for those who manage policies, empty for everyone else. */
  userIds: string[];
  groupIds: string[];
  archived: boolean;
}

export interface HolidayDTO {
  id: string;
  /** The stored date (a yearly holiday's first year). */
  date: string;
  /** Its date in the year asked for. */
  occursOn: string;
  name: string;
  repeatsYearly: boolean;
  source: string | null;
  estimated: boolean;
  userIds: string[];
  groupIds: string[];
}

export type ImportCandidateDTO = ImportCandidate;

export interface HolidayCountriesDTO {
  countries: { code: string; name: string }[];
  regions: { code: string; name: string }[];
  /** From the workspace timezone; null when no country lists it. */
  suggested: string | null;
}

export type TimeOffTab = "mine" | "review" | "archive";

export interface TimeOffRequestDTO {
  id: string;
  userId: string;
  userName: string;
  policyId: string;
  policyName: string;
  unit: TimeOffUnit;
  start: string;
  end: string;
  halfDay: boolean;
  minutes: number | null;
  amountCenti: number;
  note: string;
  status: TimeOffStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canReview: boolean;
}

/** The request dialog's preview (amounts in hundredths of the unit). */
export interface TimeOffPreviewDTO {
  amountCenti: number;
  unit: TimeOffUnit;
  /** Available now: the balance less pending requests. */
  balanceCenti: number;
  afterCenti: number;
  unlimited: boolean;
}

export interface BalanceDTO {
  userId: string;
  userName: string;
  policyId: string;
  policyName: string;
  unit: TimeOffUnit;
  year: number;
  balance: Balance;
}

export interface TimeOffDayDTO {
  dateKey: string;
  minutes: number;
  policyName: string;
  status: "APPROVED";
}

export interface TimeOffRangeDTO {
  timeOff: TimeOffDayDTO[];
  holidays: { dateKey: string; name: string }[];
}

export interface TimeOffCalendarDTO {
  month: string;
  days: {
    dateKey: string;
    away: {
      userId: string;
      userName: string;
      policyName: string;
      halfDay: boolean;
      status: TimeOffStatus;
    }[];
    holidays: string[];
  }[];
}
