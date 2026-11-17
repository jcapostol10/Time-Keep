import type { TimesheetRowKey } from "@timekeep/core";

/**
 * Rows added by hand on the timesheet are kept in local storage per
 * workspace, viewer (another account on the same browser never sees them),
 * person shown and week, so they survive a reload (templates are the
 * server-side way to keep rows for every week).
 */
export function storedRowsKey(
  slug: string,
  viewerId: string,
  target: string,
  weekKey: string,
): string {
  return `timekeep:timesheet-rows:${slug}:${viewerId}:${target}:${weekKey}`;
}

export function serializeRows(rows: TimesheetRowKey[]): string {
  return JSON.stringify(
    rows.map((r) => ({ projectId: r.projectId, taskId: r.taskId, description: r.description })),
  );
}

const nullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

function isRow(v: unknown): v is TimesheetRowKey {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    nullableString(r.projectId) && nullableString(r.taskId) && typeof r.description === "string"
  );
}

/** Stored rows that still make sense: well-formed, on no project or a project still offered. */
export function parseStoredRows(
  raw: string | null,
  offered: ReadonlySet<string>,
): TimesheetRowKey[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isRow)) return [];
  return value
    .filter((r) => r.projectId === null || offered.has(r.projectId))
    .map((r) => ({ projectId: r.projectId, taskId: r.taskId, description: r.description }));
}
