import { describe, expect, it } from "vitest";

import { canManageCatalog, canSeeProject, trackingBlock } from "./catalog";

describe("canManageCatalog", () => {
  it("allows owners and admins only", () => {
    expect(canManageCatalog("owner")).toBe(true);
    expect(canManageCatalog("admin")).toBe(true);
    expect(canManageCatalog("manager")).toBe(false);
    expect(canManageCatalog("member")).toBe(false);
  });
});

describe("canSeeProject", () => {
  it("lets admins see private projects they are not on", () => {
    expect(canSeeProject({ role: "admin", visibility: "PRIVATE", isMember: false })).toBe(true);
    expect(canSeeProject({ role: "owner", visibility: "PRIVATE", isMember: false })).toBe(true);
  });

  it("shows members public projects, and private ones only when they are on them", () => {
    expect(canSeeProject({ role: "member", visibility: "PUBLIC", isMember: false })).toBe(true);
    expect(canSeeProject({ role: "member", visibility: "PRIVATE", isMember: false })).toBe(false);
    expect(canSeeProject({ role: "member", visibility: "PRIVATE", isMember: true })).toBe(true);
  });

  it("treats managers as members until Phase 4", () => {
    expect(canSeeProject({ role: "manager", visibility: "PRIVATE", isMember: false })).toBe(false);
    expect(canSeeProject({ role: "manager", visibility: "PRIVATE", isMember: true })).toBe(true);
  });
});

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
