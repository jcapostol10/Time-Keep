import { describe, expect, it } from "vitest";

import {
  createManualEntrySchema,
  createProjectSchema,
  DEFAULT_TRACKER_SETTINGS,
  ENTRY_DESCRIPTION_MAX,
  entryDetailsSchema,
  entryIdsSchema,
  isoInstantSchema,
  stopTimerSchema,
  trackerSettingsSchema,
  updateEntrySchema,
} from "./schemas";

describe("isoInstantSchema", () => {
  it("parses ISO instants into Dates and rejects everything else", () => {
    const parsed = isoInstantSchema.parse("2026-03-09T01:00:00.000Z");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.toISOString()).toBe("2026-03-09T01:00:00.000Z");
    expect(isoInstantSchema.parse("2026-03-09T09:00:00+08:00").toISOString()).toBe(
      "2026-03-09T01:00:00.000Z",
    );
    expect(isoInstantSchema.safeParse("2026-03-09").success).toBe(false);
    expect(isoInstantSchema.safeParse("yesterday").success).toBe(false);
  });
});

describe("entry payloads", () => {
  it("entryDetailsSchema fills defaults", () => {
    expect(entryDetailsSchema.parse({})).toEqual({
      description: "",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
    });
  });

  it("caps the description length", () => {
    expect(
      entryDetailsSchema.safeParse({ description: "x".repeat(ENTRY_DESCRIPTION_MAX) }).success,
    ).toBe(true);
    expect(
      entryDetailsSchema.safeParse({ description: "x".repeat(ENTRY_DESCRIPTION_MAX + 1) }).success,
    ).toBe(false);
  });

  it("createManualEntrySchema requires start and end instants", () => {
    const ok = createManualEntrySchema.parse({
      description: "Manual",
      start: "2026-03-09T01:00:00Z",
      end: "2026-03-09T02:00:00Z",
    });
    expect(ok.start).toBeInstanceOf(Date);
    expect(ok.end.getTime() - ok.start.getTime()).toBe(3_600_000);
    expect(createManualEntrySchema.safeParse({ start: "2026-03-09T01:00:00Z" }).success).toBe(
      false,
    );
  });

  it("updateEntrySchema accepts a partial patch", () => {
    expect(updateEntrySchema.parse({ billable: true })).toEqual({ billable: true });
    expect(updateEntrySchema.safeParse({ end: "nope" }).success).toBe(false);
  });

  it("stopTimerSchema takes an optional explicit end", () => {
    expect(stopTimerSchema.parse({ entryId: "e1" })).toEqual({ entryId: "e1" });
    expect(
      stopTimerSchema.parse({ entryId: "e1", end: "2026-03-09T01:00:00Z" }).end,
    ).toBeInstanceOf(Date);
  });

  it("entryIdsSchema needs at least one id", () => {
    expect(entryIdsSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(entryIdsSchema.safeParse({ ids: ["a"] }).success).toBe(true);
  });

  it("createProjectSchema trims the name and validates the colour", () => {
    expect(createProjectSchema.parse({ name: "  Website  " })).toEqual({ name: "Website" });
    expect(createProjectSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x", color: "blue" }).success).toBe(false);
  });
});

describe("trackerSettingsSchema", () => {
  it("accepts the defaults", () => {
    expect(trackerSettingsSchema.safeParse(DEFAULT_TRACKER_SETTINGS).success).toBe(true);
    expect(DEFAULT_TRACKER_SETTINGS.idleDetectionMinutes).toBeNull();
    expect(DEFAULT_TRACKER_SETTINGS.reminderDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("requires the reminder window to end after it starts", () => {
    const result = trackerSettingsSchema.safeParse({
      ...DEFAULT_TRACKER_SETTINGS,
      reminderStartMinutes: 600,
      reminderEndMinutes: 600,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["reminderEndMinutes"]);
  });

  it("bounds idle minutes and rejects fractions", () => {
    expect(
      trackerSettingsSchema.safeParse({ ...DEFAULT_TRACKER_SETTINGS, idleDetectionMinutes: 0 })
        .success,
    ).toBe(false);
    expect(
      trackerSettingsSchema.safeParse({ ...DEFAULT_TRACKER_SETTINGS, idleDetectionMinutes: 1.5 })
        .success,
    ).toBe(false);
    expect(
      trackerSettingsSchema.safeParse({ ...DEFAULT_TRACKER_SETTINGS, idleDetectionMinutes: 15 })
        .success,
    ).toBe(true);
  });
});
