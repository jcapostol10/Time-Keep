import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Tasks by group (decision 11): every member-facing task list comes from
 * `visibleTasksFor` in catalog/tasks.ts, so the rule lives in one place. A
 * server module that reads the task table must be listed here with the reason
 * it may; a new reader fails this test until someone has looked at it.
 */

const SERVER = path.resolve(__dirname);

const ALLOWED: Record<string, string> = {
  "catalog/tasks.ts": "the one source of task lists (visibleTasksFor, listTasks, the access lists)",
  "catalog/projects.ts":
    "copyProject copies a project's tasks; listPickerProjects builds its tasks from visibleTasksFor",
  "time-entries.ts": "loads one task by id to validate an entry's details",
  "favorites.ts": "loads pinned tasks by id",
  "rates.ts": "resolves a rate target by id; the Rates page is admin-only",
  "reports.ts": "joins task for names and the Audit noTask criterion; its options come from listPickerProjects",
  "actions/tasks.ts": "finds a task's project for authorize",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

/** Whether the module reads task rows: the `task` table import, the relational query or a `tasks:` include. */
function readsTasks(source: string): boolean {
  const dbImport = source.match(/import\s*\{([^}]*)\}\s*from\s*"@timekeep\/db"/);
  const importsTask = dbImport ? /(^|[\s,])task($|[\s,])/.test(dbImport[1]!) : false;
  return importsTask || /\bquery\.task\b/.test(source) || /\btasks:\s*\{/.test(source);
}

describe("member-facing task lists come only from catalog/tasks.ts", () => {
  const readers = files(SERVER)
    .filter((f) => readsTasks(readFileSync(f, "utf8")))
    .map((f) => path.relative(SERVER, f).split(path.sep).join("/"))
    .sort();

  it("every module that reads task rows is listed with its reason", () => {
    expect(readers.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it("lists no module that no longer reads tasks", () => {
    expect(Object.keys(ALLOWED).filter((f) => !readers.includes(f))).toEqual([]);
  });

  it("listPickerProjects takes its tasks from visibleTasksFor, not a relational include", () => {
    const source = readFileSync(path.join(SERVER, "catalog/projects.ts"), "utf8");
    expect(source).not.toMatch(/\btasks:\s*\{/);
    expect(source).toMatch(/visibleTasksFor\(/);
  });
});
