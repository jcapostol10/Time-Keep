import { describe, expect, it } from "vitest";

import type { EntryDraft } from "../../lib/tracker-types";
import { pruneDraft } from "./draft-prune";

const options = {
  projects: [
    {
      id: "p1",
      name: "A",
      color: "#000000",
      clientId: null,
      clientName: null,
      billable: true,
      favorite: false,
      canCreateTask: false,
      tasks: [{ id: "t1", name: "T" }],
    },
  ],
  tags: [{ id: "a", name: "a", color: "#000000" }],
};
const draft: EntryDraft = {
  description: "x",
  projectId: "p1",
  taskId: "t1",
  tagIds: ["a"],
  billable: true,
  type: "work",
};

describe("pruneDraft", () => {
  it("keeps a draft the options still offer", () => {
    expect(pruneDraft(draft, options)).toEqual(draft);
  });

  it("drops a project the options no longer list, with its task", () => {
    expect(pruneDraft({ ...draft, projectId: "gone" }, options)).toMatchObject({
      projectId: null,
      taskId: null,
    });
  });

  it("drops a task its project no longer lists", () => {
    expect(pruneDraft({ ...draft, taskId: "done" }, options)).toMatchObject({
      projectId: "p1",
      taskId: null,
    });
  });

  it("drops tags that are gone", () => {
    expect(pruneDraft({ ...draft, tagIds: ["a", "archived"] }, options).tagIds).toEqual(["a"]);
  });
});
