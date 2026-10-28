import { describe, expect, it } from "vitest";

import { trackingBlock } from "./catalog";

describe("trackingBlock", () => {
  const live = { id: "p1", archived: false };

  it("allows an active project, an active task of that project and live tags", () => {
    expect(
      trackingBlock({
        project: live,
        task: { projectId: "p1", status: "ACTIVE" },
        tags: [{ name: "design", archived: false }],
      }),
    ).toBeNull();
    expect(trackingBlock({ project: null, task: null, tags: [] })).toBeNull();
  });

  it("blocks an archived project", () => {
    expect(trackingBlock({ project: { id: "p1", archived: true }, task: null, tags: [] })).toBe(
      "This project is archived.",
    );
  });

  it("blocks a done task", () => {
    expect(
      trackingBlock({ project: live, task: { projectId: "p1", status: "DONE" }, tags: [] }),
    ).toBe("This task is done.");
  });

  it("blocks a task of another project, or a task without a project", () => {
    expect(
      trackingBlock({ project: live, task: { projectId: "p2", status: "ACTIVE" }, tags: [] }),
    ).toBe("This task belongs to another project.");
    expect(
      trackingBlock({ project: null, task: { projectId: "p1", status: "ACTIVE" }, tags: [] }),
    ).toBe("This task belongs to another project.");
  });

  it("blocks an archived tag by name", () => {
    expect(
      trackingBlock({
        project: live,
        task: null,
        tags: [
          { name: "design", archived: false },
          { name: "urgent", archived: true },
        ],
      }),
    ).toBe('Tag "urgent" is archived.');
  });

  it("reports the project before the task", () => {
    expect(
      trackingBlock({
        project: { id: "p1", archived: true },
        task: { projectId: "p1", status: "DONE" },
        tags: [],
      }),
    ).toBe("This project is archived.");
  });
});

describe("trackingBlock and templates", () => {
  it("takes no time on a template", () => {
    expect(
      trackingBlock({ project: { id: "p", archived: false, isTemplate: true }, task: null, tags: [] }),
    ).toBe("This project is a template.");
    expect(
      trackingBlock({ project: { id: "p", archived: false, isTemplate: false }, task: null, tags: [] }),
    ).toBeNull();
  });
});
