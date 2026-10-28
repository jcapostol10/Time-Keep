import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { EntriesPage, TimeEntryDTO } from "@/lib/tracker-types";

import { insertEntry, patchEntry, removeEntries, replaceEntry } from "./entry-cache";

function dto(id: string, start: string, extra: Partial<TimeEntryDTO> = {}): TimeEntryDTO {
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
    end: start,
    durationSeconds: 60,
    updatedAt: start,
    ...extra,
  };
}

const thisWeek: EntriesPage = {
  weekStart: "2026-03-08T16:00:00.000Z",
  weekEnd: "2026-03-15T16:00:00.000Z",
  entries: [dto("b", "2026-03-10T05:00:00.000Z"), dto("a", "2026-03-09T05:00:00.000Z")],
  nextCursor: "2026-03-08T16:00:00.000Z",
};
const lastWeek: EntriesPage = {
  weekStart: "2026-03-01T16:00:00.000Z",
  weekEnd: "2026-03-08T16:00:00.000Z",
  entries: [dto("c", "2026-03-04T05:00:00.000Z")],
  nextCursor: null,
};
const data: InfiniteData<EntriesPage, string | null> = {
  pages: [thisWeek, lastWeek],
  pageParams: [null, "2026-03-08T16:00:00.000Z"],
};

const ids = (d: InfiniteData<EntriesPage, string | null>) =>
  d.pages.map((p) => p.entries.map((e) => e.id));

describe("entry cache helpers", () => {
  it("patchEntry updates one entry and leaves the input untouched", () => {
    const next = patchEntry(data, "a", { description: "edited" });
    expect(next.pages[0]?.entries[1]?.description).toBe("edited");
    expect(data.pages[0]?.entries[1]?.description).toBe("a");
  });

  it("removeEntries drops ids across pages", () => {
    expect(ids(removeEntries(data, ["a", "c"]))).toEqual([["b"], []]);
  });

  it("insertEntry places the entry in its week, newest first", () => {
    expect(ids(insertEntry(data, dto("n", "2026-03-09T10:00:00.000Z")).data)).toEqual([
      ["b", "n", "a"],
      ["c"],
    ]);
    expect(insertEntry(data, dto("n", "2026-03-09T10:00:00.000Z")).placed).toBe(true);
  });

  it("insertEntry puts entries after the current week on the first page", () => {
    const result = insertEntry(data, dto("future", "2026-03-20T05:00:00.000Z"));
    expect(result.placed).toBe(true);
    expect(ids(result.data)).toEqual([["future", "b", "a"], ["c"]]);
  });

  it("insertEntry reports when no loaded week contains the entry", () => {
    const result = insertEntry(data, dto("old", "2026-01-01T00:00:00.000Z"));
    expect(result.placed).toBe(false);
    expect(ids(result.data)).toEqual(ids(data));
  });

  it("insertEntry does not duplicate an existing id", () => {
    expect(ids(insertEntry(data, dto("a", "2026-03-09T05:00:00.000Z")).data)).toEqual([
      ["b", "a"],
      ["c"],
    ]);
  });

  it("replaceEntry moves an entry whose start changed week", () => {
    const moved = replaceEntry(data, dto("a", "2026-03-04T09:00:00.000Z"));
    expect(ids(moved.data)).toEqual([["b"], ["a", "c"]]);
    expect(moved.placed).toBe(true);
  });
});
