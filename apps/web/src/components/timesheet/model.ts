import type { TimesheetEntry, TimesheetRowKey } from "@timekeep/core";

import type { PickerProject, TimeEntryDTO } from "@/lib/tracker-types";

/** Names and defaults for the rows, gathered from the week's entries and the picker options. */
export interface NameLookup {
  projects: Map<string, { name: string; color: string; billable: boolean }>;
  tasks: Map<string, string>;
}

export function buildNameLookup(entries: TimeEntryDTO[], options: PickerProject[]): NameLookup {
  const projects = new Map<string, { name: string; color: string; billable: boolean }>();
  const tasks = new Map<string, string>();
  for (const p of options) {
    projects.set(p.id, { name: p.name, color: p.color, billable: p.billable });
    for (const t of p.tasks) tasks.set(t.id, t.name);
  }
  for (const e of entries) {
    if (e.project && !projects.has(e.project.id)) {
      projects.set(e.project.id, { name: e.project.name, color: e.project.color, billable: false });
    }
    if (e.task && !tasks.has(e.task.id)) tasks.set(e.task.id, e.task.name);
  }
  return { projects, tasks };
}

/** "Website › Design" / "No project". */
export function projectPart(key: TimesheetRowKey, names: NameLookup): string {
  const project = key.projectId ? names.projects.get(key.projectId) : undefined;
  if (!project) return key.projectId ? "Unknown project" : "No project";
  const task = key.taskId ? names.tasks.get(key.taskId) : undefined;
  return task ? `${project.name} › ${task}` : project.name;
}

/** The accessible row name: "Website › Design · Site work". */
export function rowLabel(key: TimesheetRowKey, names: NameLookup): string {
  const base = projectPart(key, names);
  return key.description ? `${base} · ${key.description}` : base;
}

/** Projects by name (none last), then task, then description. */
export function compareRows(names: NameLookup) {
  return (a: TimesheetRowKey, b: TimesheetRowKey): number => {
    const pa = a.projectId ? (names.projects.get(a.projectId)?.name ?? "") : "￿";
    const pb = b.projectId ? (names.projects.get(b.projectId)?.name ?? "") : "￿";
    return (
      pa.localeCompare(pb) ||
      (a.taskId ? (names.tasks.get(a.taskId) ?? "") : "").localeCompare(
        b.taskId ? (names.tasks.get(b.taskId) ?? "") : "",
      ) ||
      a.description.localeCompare(b.description)
    );
  };
}

/** Stopped entries only; the running timer is not in the grid. */
export function toTimesheetEntries(entries: TimeEntryDTO[]): TimesheetEntry[] {
  return entries.flatMap((e) =>
    e.end && e.durationSeconds !== null
      ? [
          {
            id: e.id,
            projectId: e.projectId,
            taskId: e.taskId,
            description: e.description,
            start: e.start,
            end: e.end,
            durationSeconds: e.durationSeconds,
          },
        ]
      : [],
  );
}

/** "Mon 9": the column heading for a day's starting instant. */
export function dayHeading(dayStart: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
  }).format(dayStart);
}
