import { describe, expect, it } from "vitest";

import {
  missingRequiredField,
  REQUIRED_FIELDS,
  type RequiredField,
  requiredFieldMessage,
} from "./required-fields";
import type { EntryType } from "./schemas";

function entry(overrides: Partial<Parameters<typeof missingRequiredField>[1]> = {}) {
  return {
    description: "Design review",
    projectId: "p1",
    taskId: "t1",
    tagIds: ["tag1"],
    type: "work" as EntryType,
    ...overrides,
  };
}

const withTasks = { projectHasTasks: true };
const noTasks = { projectHasTasks: false };

describe("missingRequiredField", () => {
  it("is null when nothing is required", () => {
    expect(
      missingRequiredField([], entry({ projectId: null, taskId: null, tagIds: [] }), withTasks),
    ).toBeNull();
  });

  it("names a missing project", () => {
    expect(missingRequiredField(["project"], entry({ projectId: null }), noTasks)).toBe("project");
    expect(missingRequiredField(["project"], entry(), noTasks)).toBeNull();
  });

  it("requires a task only when the project has active tasks", () => {
    expect(missingRequiredField(["task"], entry({ taskId: null }), noTasks)).toBeNull();
    expect(missingRequiredField(["task"], entry({ taskId: null }), withTasks)).toBe("task");
    expect(missingRequiredField(["task"], entry(), withTasks)).toBeNull();
  });

  it("names missing tags and a blank description", () => {
    expect(missingRequiredField(["tag"], entry({ tagIds: [] }), withTasks)).toBe("tag");
    expect(missingRequiredField(["description"], entry({ description: "   " }), withTasks)).toBe(
      "description",
    );
  });

  it("reports the first missing field in the fixed order", () => {
    const all: RequiredField[] = ["description", "tag", "task", "project"];
    const bare = entry({ description: "", projectId: null, taskId: null, tagIds: [] });
    expect(missingRequiredField(all, bare, withTasks)).toBe(REQUIRED_FIELDS[0]);
    expect(missingRequiredField(all, { ...bare, projectId: "p1" }, withTasks)).toBe("task");
    expect(missingRequiredField(all, { ...bare, projectId: "p1" }, noTasks)).toBe("tag");
  });

  it("exempts breaks from every rule", () => {
    const brk = entry({
      type: "break",
      description: "",
      projectId: null,
      taskId: null,
      tagIds: [],
    });
    expect(missingRequiredField([...REQUIRED_FIELDS], brk, withTasks)).toBeNull();
  });
});

describe("requiredFieldMessage", () => {
  it("names the field", () => {
    expect(requiredFieldMessage("project")).toBe("Project is required.");
    expect(requiredFieldMessage("description")).toBe("Description is required.");
  });
});
