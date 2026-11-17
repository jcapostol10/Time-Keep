import { describe, expect, it } from "vitest";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { insertIntoRange, patchRange, removeFromRange } from "./range-cache";

function dto(id: string, start: string, end: string): TimeEntryDTO {
  return {
    id,
    description: id,
    projectId: null,
    project: null,
    taskId: null,
    task: null,
    tags: [],
    tagIds: [],
    billable: false,
    type: "work",
    start,
    end,
    durationSeconds: (Date.parse(end) - Date.parse(start)) / 1000,
    updatedAt: start,
    invoiceNumber: null,
  };
}

const a = dto("a", "2026-03-09T01:00:00.000Z", "2026-03-09T02:00:00.000Z");
const b = dto("b", "2026-03-10T01:00:00.000Z", "2026-03-10T01:30:00.000Z");

describe("range cache", () => {
  it("patchRange moves an entry and recomputes its duration", () => {
    const [moved] = patchRange([a], "a", {
      start: "2026-03-09T03:00:00.000Z",
      end: "2026-03-09T05:00:00.000Z",
    });
    expect(moved).toMatchObject({
      start: "2026-03-09T03:00:00.000Z",
      end: "2026-03-09T05:00:00.000Z",
      durationSeconds: 7200,
    });
  });

  it("patchRange keeps the other end when only one moves", () => {
    const [moved] = patchRange([a], "a", { end: "2026-03-09T02:30:00.000Z" });
    expect(moved).toMatchObject({ start: a.start, durationSeconds: 5400 });
  });

  it("patchRange leaves other entries and the order alone", () => {
    const list = [b, a];
    const next = patchRange(list, "a", { start: "2026-03-09T00:00:00.000Z" });
    expect(next.map((e) => e.id)).toEqual(["b", "a"]);
    expect(next[0]).toBe(b);
    expect(patchRange(list, "zzz", { start: a.start })).toBe(list);
  });

  it("removeFromRange drops only the ids given", () => {
    expect(removeFromRange([a, b], ["a"]).map((e) => e.id)).toEqual(["b"]);
  });

  it("insertIntoRange adds an entry that starts inside the range, once", () => {
    const from = "2026-03-08T16:00:00.000Z";
    const to = "2026-03-15T16:00:00.000Z";
    expect(insertIntoRange([b], a, from, to).map((e) => e.id)).toEqual(["b", "a"]);
    expect(insertIntoRange([a, b], a, from, to)).toEqual([a, b]);
    const outside = dto("c", "2026-03-16T01:00:00.000Z", "2026-03-16T02:00:00.000Z");
    expect(insertIntoRange([b], outside, from, to)).toEqual([b]);
  });
});
