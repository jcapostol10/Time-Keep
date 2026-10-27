import { describe, expect, it } from "vitest";

import {
  clientInputSchema,
  clientPatchSchema,
  currencyCodeSchema,
  dateRangeSchema,
  deleteProjectSchema,
  changeRoleSchema,
  inviteMemberSchema,
  managerScopeSchema,
  memberStatusSchema,
  transferOwnershipSchema,
  projectInputSchema,
  projectPatchSchema,
  timesheetTemplateInputSchema,
  isValidTimeZone,
  slugSchema,
  timeZoneSchema,
  workspaceSettingsSchema,
} from "./schemas";

describe("timezone validation", () => {
  it("accepts IANA zones and UTC", () => {
    expect(isValidTimeZone("Asia/Manila")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(timeZoneSchema.safeParse("Europe/London").success).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(timeZoneSchema.safeParse("").success).toBe(false);
  });
});

describe("currency", () => {
  it("requires a 3-letter uppercase code", () => {
    expect(currencyCodeSchema.safeParse("PHP").success).toBe(true);
    expect(currencyCodeSchema.safeParse("usd").success).toBe(false);
    expect(currencyCodeSchema.safeParse("US").success).toBe(false);
  });
});

describe("slug", () => {
  it("accepts kebab-case only", () => {
    expect(slugSchema.safeParse("acme-2").success).toBe(true);
    expect(slugSchema.safeParse("Acme").success).toBe(false);
    expect(slugSchema.safeParse("-acme").success).toBe(false);
    expect(slugSchema.safeParse("a").success).toBe(false);
  });
});

describe("workspace settings", () => {
  it("accepts a full valid payload", () => {
    const parsed = workspaceSettingsSchema.parse({
      timezone: "Asia/Manila",
      weekStart: 1,
      timeFormat: "12h",
      durationFormat: "decimal",
      currency: "PHP",
    });
    expect(parsed.weekStart).toBe(1);
  });
  it("rejects a week start outside 0–6 or given as a string", () => {
    const base = { timezone: "UTC", timeFormat: "24h", durationFormat: "hh:mm", currency: "USD" };
    expect(workspaceSettingsSchema.safeParse({ ...base, weekStart: 7 }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ ...base, weekStart: "1" }).success).toBe(false);
  });
});

describe("invite", () => {
  it("normalises email and forbids inviting an owner", () => {
    const ok = inviteMemberSchema.parse({ email: "  Dev@Example.COM ", role: "member" });
    expect(ok.email).toBe("dev@example.com");
    expect(inviteMemberSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
  });
});

describe("client input", () => {
  it("trims the name and defaults the rest", () => {
    const parsed = clientInputSchema.parse({ name: " Acme " });
    expect(parsed).toEqual({ name: "Acme", address: "", email: "", notes: "", currency: null });
  });

  it("accepts an empty email or a valid one, nothing else", () => {
    expect(clientInputSchema.safeParse({ name: "Acme", email: "" }).success).toBe(true);
    expect(clientInputSchema.safeParse({ name: "Acme", email: "a@b.co" }).success).toBe(true);
    expect(clientInputSchema.safeParse({ name: "Acme", email: "nope" }).success).toBe(false);
  });
});

describe("project input", () => {
  it("defaults to billable, public, no client", () => {
    const parsed = projectInputSchema.parse({ name: "Website" });
    expect(parsed).toMatchObject({
      name: "Website",
      clientId: null,
      billable: true,
      visibility: "PUBLIC",
      note: "",
    });
    expect(parsed.color).toBeUndefined();
  });
});

describe("delete project", () => {
  it("accepts both modes and requires a target for reassign", () => {
    expect(deleteProjectSchema.safeParse({ mode: "delete" }).success).toBe(true);
    expect(deleteProjectSchema.safeParse({ mode: "reassign", projectId: "p2" }).success).toBe(true);
    expect(deleteProjectSchema.safeParse({ mode: "reassign", projectId: null }).success).toBe(true);
    expect(deleteProjectSchema.safeParse({ mode: "reassign" }).success).toBe(false);
  });
});

describe("date range", () => {
  it("rejects a span over a year, so no view can ask for everything", () => {
    const from = "2026-01-01T00:00:00.000Z";
    expect(dateRangeSchema.safeParse({ from, to: "2026-12-31T00:00:00.000Z" }).success).toBe(true);
    const over = dateRangeSchema.safeParse({ from, to: "2027-01-03T00:00:00.000Z" });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toBe("Pick a range of at most one year.");
  });
});

describe("timesheet template", () => {
  it("caps rows at 50", () => {
    const row = { projectId: null, taskId: null, description: "" };
    const rows = (n: number) => Array.from({ length: n }, () => row);
    expect(timesheetTemplateInputSchema.safeParse({ name: "Week", rows: rows(50) }).success).toBe(
      true,
    );
    expect(timesheetTemplateInputSchema.safeParse({ name: "Week", rows: rows(51) }).success).toBe(
      false,
    );
  });
});

describe("patch schemas", () => {
  it("a project patch carries only the keys given, never the input defaults", () => {
    expect(projectPatchSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(projectPatchSchema.parse({ name: " X ", note: "n" })).toEqual({ name: "X", note: "n" });
  });

  it("a client patch carries only the keys given", () => {
    expect(clientPatchSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(clientPatchSchema.parse({ email: "" })).toEqual({ email: "" });
    expect(clientPatchSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("team schemas", () => {
  it("assigns any role but owner, and only the two statuses", () => {
    expect(changeRoleSchema.parse({ userId: "u1", role: "manager" })).toEqual({
      userId: "u1",
      role: "manager",
    });
    expect(changeRoleSchema.safeParse({ userId: "u1", role: "owner" }).success).toBe(false);
    expect(memberStatusSchema.safeParse({ userId: "u1", status: "INVITED" }).success).toBe(false);
    expect(memberStatusSchema.parse({ userId: "u1", status: "DEACTIVATED" }).status).toBe(
      "DEACTIVATED",
    );
  });

  it("defaults a manager's scope to nothing and caps its size", () => {
    expect(managerScopeSchema.parse({ managerId: "m1" })).toEqual({
      managerId: "m1",
      userIds: [],
      groupIds: [],
      projectIds: [],
    });
    const many = Array.from({ length: 501 }, (_, i) => `u${i}`);
    expect(managerScopeSchema.safeParse({ managerId: "m1", userIds: many }).success).toBe(false);
  });

  it("needs the workspace name to transfer ownership", () => {
    expect(transferOwnershipSchema.safeParse({ userId: "u1", confirmName: "  " }).success).toBe(
      false,
    );
    expect(transferOwnershipSchema.parse({ userId: "u1", confirmName: " Acme " }).confirmName).toBe(
      "Acme",
    );
  });
});
