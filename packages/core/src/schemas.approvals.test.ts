import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_SETTINGS,
  entryNoteSchema,
  lockSettingsCheck,
  reviewRequestsSchema,
  submitPeriodSchema,
  updateEntrySchema,
  workspaceSettingsSchema,
} from "./schemas";

const withLock = workspaceSettingsSchema.superRefine(lockSettingsCheck);

describe("approval and lock settings", () => {
  it("defaults to approval and lock off", () => {
    expect(DEFAULT_WORKSPACE_SETTINGS).toMatchObject({
      approvalEnabled: false,
      approvalPeriod: "WEEKLY",
      approvalReviewers: "ADMINS",
      lockMode: "OFF",
      lockDate: null,
      lockDays: null,
    });
    expect(withLock.safeParse(DEFAULT_WORKSPACE_SETTINGS).success).toBe(true);
  });

  it("needs a date for a fixed lock and days for a rolling one", () => {
    const fixed = withLock.safeParse({ ...DEFAULT_WORKSPACE_SETTINGS, lockMode: "FIXED" });
    expect(fixed.success).toBe(false);
    expect(fixed.error?.issues[0]?.path).toEqual(["lockDate"]);
    const rolling = withLock.safeParse({ ...DEFAULT_WORKSPACE_SETTINGS, lockMode: "ROLLING" });
    expect(rolling.error?.issues[0]?.path).toEqual(["lockDays"]);
    expect(
      withLock.safeParse({ ...DEFAULT_WORKSPACE_SETTINGS, lockMode: "ROLLING", lockDays: 7 })
        .success,
    ).toBe(true);
    expect(
      withLock.safeParse({
        ...DEFAULT_WORKSPACE_SETTINGS,
        lockMode: "FIXED",
        lockDate: "2026-10-20",
      }).success,
    ).toBe(true);
  });

  it("caps rolling days at a year", () => {
    expect(
      withLock.safeParse({ ...DEFAULT_WORKSPACE_SETTINGS, lockMode: "ROLLING", lockDays: 366 })
        .success,
    ).toBe(false);
  });
});

describe("notes and review input", () => {
  it("trims a note and wants a few characters", () => {
    expect(entryNoteSchema.parse("  fixed the client  ")).toBe("fixed the client");
    expect(entryNoteSchema.safeParse(" a ").success).toBe(false);
  });

  it("lets every entry write carry a note", () => {
    expect(updateEntrySchema.parse({ note: "client asked" }).note).toBe("client asked");
  });

  it("needs a note to reject", () => {
    expect(reviewRequestsSchema.safeParse({ ids: ["r1"], decision: "REJECT" }).success).toBe(false);
    expect(
      reviewRequestsSchema.safeParse({ ids: ["r1"], decision: "REJECT", note: "missing Friday" })
        .success,
    ).toBe(true);
    expect(reviewRequestsSchema.safeParse({ ids: ["r1"], decision: "APPROVE" }).success).toBe(true);
    expect(reviewRequestsSchema.safeParse({ ids: [], decision: "APPROVE" }).success).toBe(false);
  });

  it("takes a period by its first day", () => {
    expect(submitPeriodSchema.safeParse({ periodStart: "2026-10-26" }).success).toBe(true);
    expect(submitPeriodSchema.safeParse({ periodStart: "26/10/2026" }).success).toBe(false);
  });
});
