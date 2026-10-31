import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { functions } from "../../test/source-functions";

/**
 * Every exported writer of the entry service passes the Phase 5a write guard:
 * a function that writes `time_entry` (directly, or through a function of the
 * same file that does) must call `assertWritable` (directly, or through a
 * function that does), or be listed below with the reason it may not.
 */

const FILE = path.resolve(__dirname, "time-entries.ts");

const EXEMPT: Record<string, string> = {
  stopTimer: "a stop is always allowed (decision 6), including an administrative one",
  reassignProjectEntries: "deleteProject refuses while the project has submitted time",
  softDeleteProjectEntries: "deleteProject refuses while the project has submitted time",
};

const WRITES = /\.(insert|update)\(timeEntry\)/;

function calls(body: string, name: string): boolean {
  return new RegExp(`\\b${name}\\(`).test(body);
}

/** Names whose body satisfies `direct`, or calls one that does (to a fixed point). */
function closure(
  fns: Map<string, { body: string }>,
  direct: (body: string) => boolean,
): Set<string> {
  const found = new Set([...fns].filter(([, f]) => direct(f.body)).map(([n]) => n));
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, f] of fns) {
      if (!found.has(name) && [...found].some((n) => n !== name && calls(f.body, n))) {
        found.add(name);
        grew = true;
      }
    }
  }
  return found;
}

describe("assertWritable coverage", () => {
  const fns = functions(readFileSync(FILE, "utf8"));
  const writers = closure(fns, (b) => WRITES.test(b));
  const guarded = closure(fns, (b) => calls(b, "assertWritable"));

  it("finds the writers", () => {
    for (const name of ["startTimer", "updateEntry", "deleteEntries", "bulkUpdateEntries"]) {
      expect(writers.has(name)).toBe(true);
    }
  });

  it("guards every exported writer", () => {
    const missing = [...fns]
      .filter(([name, f]) => f.exported && writers.has(name))
      .filter(([name]) => !guarded.has(name) && !(name in EXEMPT))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("lists only real exemptions", () => {
    for (const name of Object.keys(EXEMPT)) expect(writers.has(name)).toBe(true);
  });
});
