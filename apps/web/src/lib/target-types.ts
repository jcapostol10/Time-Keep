import type { TargetKind, TargetPeriod } from "@timekeep/core";

/** A target rule as the settings card reads it (Phase 5b). */
export interface TargetRuleDTO {
  id: string;
  kind: TargetKind;
  period: TargetPeriod;
  thresholdMinutes: number;
  active: boolean;
  everyone: boolean;
  userIds: string[];
  groupIds: string[];
}
