import { formatDateKey } from "./approvals";
import { weekStartKey } from "./attendance";

/**
 * The Assignments report (Phase 7 design, decision 22): the published plan
 * against tracked time, per person, project, day or week. Both sides are raw
 * seconds; variance is tracked − scheduled.
 */

export const ASSIGNMENT_GROUP_KEYS = ["user", "project", "day", "week"] as const;
export type AssignmentGroupKey = (typeof ASSIGNMENT_GROUP_KEYS)[number];

/** One person's seconds on one project on one local day. */
export interface PlanRow {
  userId: string;
  projectId: string;
  dateKey: string;
  seconds: number;
}

export interface AssignmentsRow {
  key: string;
  label: string;
  scheduledSeconds: number;
  trackedSeconds: number;
  varianceSeconds: number;
  /** One decimal; null when nothing was scheduled. */
  variancePercent: number | null;
}

function finish(key: string, label: string, scheduled: number, tracked: number): AssignmentsRow {
  const variance = tracked - scheduled;
  return {
    key,
    label,
    scheduledSeconds: scheduled,
    trackedSeconds: tracked,
    varianceSeconds: variance,
    variancePercent: scheduled > 0 ? Math.round((variance * 1000) / scheduled) / 10 : null,
  };
}

export function assignmentsRows(
  scheduled: readonly PlanRow[],
  tracked: readonly PlanRow[],
  by: AssignmentGroupKey,
  opts: { weekStart: number; labels: ReadonlyMap<string, string> },
): { rows: AssignmentsRow[]; totals: AssignmentsRow } {
  const keyOf = (r: PlanRow) =>
    by === "user"
      ? r.userId
      : by === "project"
        ? r.projectId
        : by === "day"
          ? r.dateKey
          : weekStartKey(r.dateKey, opts.weekStart);
  const sums = new Map<string, { s: number; t: number }>();
  const add = (r: PlanRow, side: "s" | "t") => {
    const k = keyOf(r);
    const cur = sums.get(k) ?? { s: 0, t: 0 };
    cur[side] += r.seconds;
    sums.set(k, cur);
  };
  for (const r of scheduled) add(r, "s");
  for (const r of tracked) add(r, "t");
  const labelOf = (k: string) => {
    if (by === "day") return formatDateKey(k);
    if (by === "week") return `Week of ${formatDateKey(k)}`;
    return opts.labels.get(k) ?? (by === "user" ? "(former member)" : "(deleted project)");
  };
  const rows = [...sums].map(([k, v]) => finish(k, labelOf(k), v.s, v.t));
  rows.sort((a, b) =>
    by === "day" || by === "week"
      ? a.key < b.key
        ? -1
        : 1
      : a.label.localeCompare(b.label) || (a.key < b.key ? -1 : 1),
  );
  const s = rows.reduce((n, r) => n + r.scheduledSeconds, 0);
  const t = rows.reduce((n, r) => n + r.trackedSeconds, 0);
  return { rows, totals: finish("total", "Total", s, t) };
}
