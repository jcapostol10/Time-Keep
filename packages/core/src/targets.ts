import { holidayApplies, type HolidayPerson } from "./holidays";

/**
 * Target rules (Phase 5b, decision 14): UNDER reminds the person who tracked
 * too little, OVER alerts admins and managers about too much. Evaluated by the
 * daily job on raw work time.
 */

export const TARGET_KINDS = ["UNDER", "OVER"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const TARGET_PERIODS = ["DAY", "WEEK"] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];

export interface TargetRule {
  id: string;
  kind: TargetKind;
  period: TargetPeriod;
  thresholdMinutes: number;
  active: boolean;
  /** No users and no groups → everyone. */
  userIds: readonly string[];
  groupIds: readonly string[];
}

export function targetApplies(rule: TargetRule, person: HolidayPerson): boolean {
  if (!rule.active) return false;
  return holidayApplies({ ...rule, date: "", name: "", repeatsYearly: false }, person);
}

export function targetBreached(rule: TargetRule, workSeconds: number): boolean {
  const threshold = rule.thresholdMinutes * 60;
  return rule.kind === "UNDER" ? workSeconds < threshold : workSeconds > threshold;
}
