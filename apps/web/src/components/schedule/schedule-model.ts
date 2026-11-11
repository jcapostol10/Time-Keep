import {
  addDaysToKey,
  type AssignmentShape,
  daysBetweenKeys,
  moveAssignment,
  resizeAssignment,
  weekStartKey,
} from "@timekeep/core";

/**
 * The schedule's pure UI maths (Phase 7a): zoom ranges, the pointer's day
 * column, what a drag produces (through core's date edits, the same the
 * dialog uses), and which rows of a long grid to render.
 */

export const ZOOMS = ["week", "2weeks", "month"] as const;
export type Zoom = (typeof ZOOMS)[number];
export const ZOOM_LABELS: Record<Zoom, string> = {
  week: "Week",
  "2weeks": "2 weeks",
  month: "Month",
};

/** The query string of a range: the team route's and the query key's. */
export function scheduleParams(range: { from: string; to: string }): string {
  return new URLSearchParams({ from: range.from, to: range.to }).toString();
}

/** A zoom from the URL, else the week. */
export function zoomOf(value: unknown): Zoom {
  return typeof value === "string" && (ZOOMS as readonly string[]).includes(value)
    ? (value as Zoom)
    : "week";
}

export function startFor(dateKey: string, zoom: Zoom, weekStart: number): string {
  if (zoom === "month") return `${dateKey.slice(0, 7)}-01`;
  return weekStartKey(dateKey, weekStart);
}

function monthEnd(firstKey: string): string {
  const [y, m] = firstKey.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function rangeFor(from: string, zoom: Zoom): { from: string; to: string } {
  if (zoom === "month") return { from, to: monthEnd(from) };
  return { from, to: addDaysToKey(from, zoom === "week" ? 6 : 13) };
}

export function shiftFrom(from: string, zoom: Zoom, direction: 1 | -1): string {
  if (zoom !== "month") return addDaysToKey(from, direction * (zoom === "week" ? 7 : 14));
  const [y, m] = from.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + direction, 1)).toISOString().slice(0, 10);
}

/** The day column under a pointer at `x` over a track starting at `left`, `width` wide. */
export function dayIndexAt(x: number, left: number, width: number, count: number): number {
  if (count <= 0 || width <= 0) return 0;
  const index = Math.floor(((x - left) / width) * count);
  return Math.min(count - 1, Math.max(0, index));
}

export type DragKind = "create" | "move" | "resize-start" | "resize-end";

/**
 * What a drag from column `origin` to `current` makes: a new span, or the
 * assignment moved or resized by the days between them (so a drag on any
 * occurrence of a series edits the series the same way).
 */
export function dragResult(
  kind: DragKind,
  origin: number,
  current: number,
  a: AssignmentShape | null,
  days: readonly string[],
): { startDate: string; endDate: string } {
  if (kind === "create" || !a) {
    const lo = Math.min(origin, current);
    const hi = Math.max(origin, current);
    return { startDate: days[lo]!, endDate: days[hi]! };
  }
  const delta = current - origin;
  if (kind === "move") return moveAssignment(a, addDaysToKey(a.startDate, delta));
  const edge = kind === "resize-start" ? "start" : "end";
  const from = edge === "start" ? a.startDate : a.endDate;
  return resizeAssignment(a, edge, addDaysToKey(from, delta));
}

/** Whether a drag changed anything (a press without movement is a click). */
export function dragMoved(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate !== b.startDate || a.endDate !== b.endDate;
}

/** Span length in days, inclusive. */
export function spanDays(a: { startDate: string; endDate: string }): number {
  return daysBetweenKeys(a.startDate, a.endDate) + 1;
}

/**
 * The rows of a scrolling list to render: those in view plus `overscan` on
 * each side, and the heights of the spacers standing in for the rest.
 */
export function rowWindow(
  heights: readonly number[],
  scrollTop: number,
  viewport: number,
  overscan = 5,
): { start: number; end: number; before: number; after: number } {
  let y = 0;
  let first = heights.length;
  let last = heights.length;
  for (let i = 0; i < heights.length; i += 1) {
    const h = heights[i]!;
    if (first === heights.length && y + h > scrollTop) first = i;
    if (y >= scrollTop + viewport) {
      last = i;
      break;
    }
    y += h;
  }
  const start = Math.max(0, Math.min(first, heights.length) - overscan);
  const end = Math.min(heights.length, last + overscan);
  const sum = (a: number, b: number) => heights.slice(a, b).reduce((n, h) => n + h, 0);
  return { start, end, before: sum(0, start), after: sum(end, heights.length) };
}
