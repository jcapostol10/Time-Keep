import type { ApprovalAction, ApprovalStatus, Period } from "@timekeep/core";

import type { TimeEntryDTO } from "./tracker-types";

/** A submitted period (Phase 5a), as the Approvals page and the period bar read it. */
export interface ApprovalRequestDTO {
  id: string;
  userId: string;
  userName: string;
  /** Inclusive local dates (workspace timezone). */
  periodStart: string;
  periodEnd: string;
  status: ApprovalStatus;
  /** Totals when submitted. */
  workSeconds: number;
  billableSeconds: number;
  entryCount: number;
  submittedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** The reviewer's note: why it was rejected or reopened. */
  note: string | null;
}

/** A closed period with time and no request. */
export interface UnsubmittedPeriodDTO {
  userId: string;
  userName: string;
  periodStart: string;
  periodEnd: string;
  workSeconds: number;
  entryCount: number;
}

export interface ApprovalEventDTO {
  id: string;
  action: ApprovalAction;
  actorName: string | null;
  note: string | null;
  entryId: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export interface PeriodTotals {
  workSeconds: number;
  billableSeconds: number;
  entryCount: number;
}

export interface PeriodViewDTO {
  request: ApprovalRequestDTO;
  period: Period;
  /** The workspace timezone, which the days are in. */
  timezone: string;
  days: { dateKey: string; entries: TimeEntryDTO[]; workSeconds: number }[];
  /** As submitted. */
  totals: PeriodTotals;
  /** As the entries are now (they differ after an admin's edit). */
  live: PeriodTotals;
  events: ApprovalEventDTO[];
  canReview: boolean;
  canReopen: boolean;
}

/** One of the viewer's own periods in a range, for the Submit control. */
export interface MyPeriodDTO {
  period: Period;
  status: ApprovalStatus | null;
  note: string | null;
  requestId: string | null;
  workSeconds: number;
  canSubmit: boolean;
}

export type ApprovalsTab = "pending" | "unsubmitted" | "archive";
