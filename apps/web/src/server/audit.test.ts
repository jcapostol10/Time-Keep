import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import { createTask } from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import { detailedReport } from "./reports";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const NOW = new Date("2026-03-11T04:00:00.000Z");
const q = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
  ...over,
});
const DAY = new Date("2026-03-09T01:00:00.000Z");
const at = (hours: number) => new Date(DAY.getTime() + hours * 3_600_000);

let me: Viewer;

async function audit(over: Partial<ReportQuery>) {
  const page = await detailedReport(db, me, q(over), PREFS, { sort: "start", dir: "asc" }, NOW);
  return page.entries.map((e) => e.description).sort();
}

/** The Audit tab: the Detailed report filtered to problem entries (any criterion matches). */
describe("audit criteria", () => {
  beforeAll(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    me = await loadViewer(db, ws.id, olga.id);
    const withTasks = await createProject(db, me, { name: "With tasks" });
    const setup = await createTask(db, me, withTasks.id, { name: "Setup", assigneeIds: [] });
    const bare = await createProject(db, me, { name: "Bare" });
    const entry = (
      description: string,
      projectId: string | null,
      taskId: string | null,
      start: Date,
      seconds: number,
    ) =>
      createManualEntry(db, me, {
        description,
        projectId,
        taskId,
        tagIds: [],
        billable: false,
        start,
        end: new Date(start.getTime() + seconds * 1000),
      });
    await entry("no project", null, null, at(0), 3600);
    await entry("no task", withTasks.id, null, at(2), 3600);
    await entry("with task", withTasks.id, setup.id, at(4), 3600);
    await entry("bare project", bare.id, null, at(6), 3600);
    await entry("short", bare.id, null, at(8), 30);
    await entry("long", bare.id, null, at(9), 11 * 3600);
  });
  afterAll(async () => handle.close());

  it("lists everything without criteria", async () => {
    expect(await audit({})).toHaveLength(6);
  });

  it("matches each criterion alone", async () => {
    expect(await audit({ audit: ["noProject"] })).toEqual(["no project"]);
    expect(await audit({ audit: ["noTask"] })).toEqual(["no task"]);
    expect(await audit({ audit: ["short"] })).toEqual(["short"]);
    expect(await audit({ audit: ["long"] })).toEqual(["long"]);
  });

  it("combines criteria with OR", async () => {
    expect(await audit({ audit: ["noProject", "long"] })).toEqual(["long", "no project"]);
  });

  it("reads its thresholds from the query", async () => {
    expect(await audit({ audit: ["short"], shortMinutes: 120 })).toEqual([
      "bare project",
      "no project",
      "no task",
      "short",
      "with task",
    ]);
    expect(await audit({ audit: ["long"], longHours: 12 })).toEqual([]);
  });
});
