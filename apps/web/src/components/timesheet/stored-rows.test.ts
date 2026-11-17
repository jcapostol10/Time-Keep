import { describe, expect, it } from "vitest";

import { parseStoredRows, serializeRows, storedRowsKey } from "./stored-rows";

const offered = new Set(["p1"]);

describe("stored timesheet rows", () => {
  it("keys rows by workspace, person and week", () => {
    const keys = new Set([
      storedRowsKey("acme", "me", "2026-03-09"),
      storedRowsKey("acme", "me", "2026-03-16"),
      storedRowsKey("acme", "u2", "2026-03-09"),
      storedRowsKey("other", "me", "2026-03-09"),
    ]);
    expect(keys.size).toBe(4);
    expect(storedRowsKey("acme", "me", "2026-03-09")).toBe(
      "timekeep:timesheet-rows:acme:me:2026-03-09",
    );
  });

  it("parses what it serialised", () => {
    const rows = [
      { projectId: "p1", taskId: null, description: "Design" },
      { projectId: null, taskId: null, description: "Planning" },
    ];
    expect(parseStoredRows(serializeRows(rows), offered)).toEqual(rows);
  });

  it("drops rows on projects no longer offered", () => {
    const rows = [
      { projectId: "gone", taskId: "t1", description: "Old" },
      { projectId: null, taskId: null, description: "Planning" },
    ];
    expect(parseStoredRows(serializeRows(rows), offered)).toEqual([rows[1]]);
  });

  it("reads garbage as no rows", () => {
    for (const raw of [null, "", "{", "null", "[1]", '[{"projectId":5}]', '{"a":1}']) {
      expect(parseStoredRows(raw, offered)).toEqual([]);
    }
  });
});
