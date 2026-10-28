import { describe, expect, it } from "vitest";

import {
  collapseConsecutive,
  entryGroupKey,
  type GroupableEntry,
  groupByDay,
  sumDuration,
} from "./entry-grouping";

function entry(overrides: Partial<GroupableEntry> & { id: string }): GroupableEntry {
  return {
    description: "Design review",
    projectId: "p1",
    tagIds: ["t1", "t2"],
    billable: true,
    start: "2026-03-09T01:00:00.000Z",
    end: "2026-03-09T01:30:00.000Z",
    durationSeconds: 1800,
    ...overrides,
  };
}

describe("entryGroupKey", () => {
  it("keeps a break apart from a work entry with the same details", () => {
    const work = entry({ id: "a", type: "work" });
    const brk = entry({ id: "b", type: "break" });
    expect(entryGroupKey(work)).not.toBe(entryGroupKey(brk));
    // An entry without a type is work.
    expect(entryGroupKey(entry({ id: "c" }))).toBe(entryGroupKey(work));
  });
});

describe("groupByDay", () => {
  it("keys entries by their start date in the viewer's zone and lists a midnight-crossing entry once", () => {
    // 23:30 -> 00:30 Manila on March 9/10
    const crossing = entry({
      id: "a",
      start: "2026-03-09T15:30:00.000Z",
      end: "2026-03-09T16:30:00.000Z",
      durationSeconds: 3600,
    });
    const morning = entry({ id: "b", start: "2026-03-09T01:00:00.000Z" }); // 09:00 March 9
    const nextDay = entry({
      id: "c",
      start: "2026-03-10T02:00:00.000Z", // 10:00 March 10
      end: "2026-03-10T02:10:00.000Z",
      durationSeconds: 600,
    });

    const days = groupByDay([morning, crossing, nextDay], "Asia/Manila");

    expect(days.map((d) => d.dateKey)).toEqual(["2026-03-10", "2026-03-09"]);
    expect(days[0]?.entries.map((e) => e.id)).toEqual(["c"]);
    expect(days[0]?.totalSeconds).toBe(600);
    expect(days[1]?.entries.map((e) => e.id)).toEqual(["a", "b"]); // newest first
    expect(days[1]?.totalSeconds).toBe(5400);
  });

  it("returns no groups for no entries", () => {
    expect(groupByDay([], "UTC")).toEqual([]);
  });
});

describe("entryGroupKey", () => {
  it("ignores tag order and the entry's times", () => {
    const a = entry({ id: "a", tagIds: ["t1", "t2"] });
    const b = entry({ id: "b", tagIds: ["t2", "t1"], start: "2026-03-09T05:00:00.000Z" });
    expect(entryGroupKey(a)).toBe(entryGroupKey(b));
  });

  it("changes when description, project, tags or billable change", () => {
    const base = entryGroupKey(entry({ id: "a" }));
    expect(entryGroupKey(entry({ id: "b", description: "Other" }))).not.toBe(base);
    expect(entryGroupKey(entry({ id: "c", projectId: null }))).not.toBe(base);
    expect(entryGroupKey(entry({ id: "d", tagIds: ["t1"] }))).not.toBe(base);
    expect(entryGroupKey(entry({ id: "e", billable: false }))).not.toBe(base);
  });
});

describe("collapseConsecutive", () => {
  it("merges only adjacent entries with the same key", () => {
    const e1 = entry({ id: "1" });
    const e2 = entry({ id: "2", tagIds: ["t2", "t1"] });
    const e3 = entry({ id: "3", billable: false });
    const e4 = entry({ id: "4" });

    const rows = collapseConsecutive([e1, e2, e3, e4]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "group", totalSeconds: 3600 });
    expect(rows[0]?.kind === "group" && rows[0].entries.map((e) => e.id)).toEqual(["1", "2"]);
    expect(rows[1]).toMatchObject({ kind: "single", entry: { id: "3" } });
    expect(rows[2]).toMatchObject({ kind: "single", entry: { id: "4" } });
  });

  it("never groups a single entry", () => {
    expect(collapseConsecutive([entry({ id: "1" })])).toEqual([
      { kind: "single", entry: entry({ id: "1" }) },
    ]);
  });
});

describe("sumDuration", () => {
  it("ignores running entries", () => {
    expect(
      sumDuration([entry({ id: "1" }), entry({ id: "2", end: null, durationSeconds: null })]),
    ).toBe(1800);
  });
});
