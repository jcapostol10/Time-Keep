import { describe, expect, it } from "vitest";

import type { EntryDraft } from "../../lib/tracker-types";
import { draftChanges, timesChanged } from "./entry-dialog-model";

const base: EntryDraft = {
  description: "Work",
  projectId: "p1",
  taskId: "t1",
  tagIds: ["a", "b"],
  billable: true,
};

describe("entry dialog patch", () => {
  it("sends nothing for an unchanged draft, whatever the tag order", () => {
    expect(draftChanges(base, { ...base, tagIds: ["b", "a"] })).toEqual({});
  });

  it("sends only the description when only it changed", () => {
    expect(draftChanges(base, { ...base, description: "Edited" })).toEqual({
      description: "Edited",
    });
  });

  it("sends the project together with the task, since a task implies its project", () => {
    expect(draftChanges(base, { ...base, taskId: "t2" })).toEqual({
      projectId: "p1",
      taskId: "t2",
    });
    expect(draftChanges(base, { ...base, projectId: null, taskId: null })).toEqual({
      projectId: null,
      taskId: null,
    });
  });

  it("sends tags and billable when they change", () => {
    expect(draftChanges(base, { ...base, tagIds: ["a"], billable: false })).toEqual({
      tagIds: ["a"],
      billable: false,
    });
  });

  it("times count as changed only when their text was edited", () => {
    const texts = { startText: "9:00 AM", endText: "10:00 AM" };
    expect(timesChanged(texts, { ...texts })).toBe(false);
    expect(timesChanged(texts, { ...texts, endText: "10:30 AM" })).toBe(true);
  });
});
