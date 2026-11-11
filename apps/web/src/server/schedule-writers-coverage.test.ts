import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `assignment` is written only by the schedule services (Phase 7a): the writer
 * keeps the draft rules (a published row is never edited in place) and the
 * publisher applies them. A new writer fails this test until it is one of them.
 */

const SRC = path.resolve(__dirname, "..");
const ALLOWED = new Set(["server/schedule/assignments.ts", "server/schedule/publish.ts"]);
const WRITES = /\.(insert|update|delete)\(assignment\)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("assignment writers", () => {
  const writers = files(SRC)
    .filter((f) => WRITES.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();

  it("only the schedule services write assignments", () => {
    expect(writers.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });

  it("both services do write", () => {
    expect(writers).toEqual([...ALLOWED].sort());
  });
});
