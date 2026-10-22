import { DEFAULT_TRACKER_SETTINGS } from "@timekeep/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, truncateAll } from "../../../test/db";
import { getTrackerSettings, recordTestEmail, upsertTrackerSettings } from "./user-settings";

const handle = connectTestDb();
const db = handle.db;

describe("tracker settings", () => {
  beforeAll(async () => truncateAll(db));
  beforeEach(async () => truncateAll(db));
  afterAll(async () => handle.close());

  it("returns the defaults when the user has no row", async () => {
    const user = await createTestUser(db, "Ada");
    expect(await getTrackerSettings(db, user.id)).toEqual(DEFAULT_TRACKER_SETTINGS);
  });

  it("creates the row on first save and updates it afterwards", async () => {
    const user = await createTestUser(db, "Ada");
    const first = await upsertTrackerSettings(db, user.id, {
      ...DEFAULT_TRACKER_SETTINGS,
      idleDetectionMinutes: 15,
      reminderDays: [1, 3, 5],
    });
    expect(first).toMatchObject({ idleDetectionMinutes: 15, reminderDays: [1, 3, 5] });
    expect(await getTrackerSettings(db, user.id)).toEqual(first);

    const second = await upsertTrackerSettings(db, user.id, {
      ...first,
      idleDetectionMinutes: null,
      pomodoroEnabled: true,
      pomodoroFocusMinutes: 50,
    });
    expect(second).toMatchObject({
      idleDetectionMinutes: null,
      pomodoroEnabled: true,
      pomodoroFocusMinutes: 50,
    });
    expect(await getTrackerSettings(db, user.id)).toEqual(second);
  });

  it("limits test emails: a minute apart, five a day, remembered per person", async () => {
    const tess = await createTestUser(db, "Tess T");
    const t0 = new Date("2026-10-22T10:00:00.000Z");
    const at = (ms: number) => new Date(t0.getTime() + ms);
    expect(await recordTestEmail(db, tess.id, t0)).toEqual({ allowed: true });
    expect(await recordTestEmail(db, tess.id, at(10_000))).toMatchObject({
      allowed: false,
      reason: "You can send another test email in 50 seconds.",
    });
    for (let i = 1; i <= 4; i++) {
      expect(await recordTestEmail(db, tess.id, at(i * 120_000))).toEqual({ allowed: true });
    }
    expect(await recordTestEmail(db, tess.id, at(5 * 120_000))).toMatchObject({
      allowed: false,
      reason: "That is 5 test emails today; try again tomorrow.",
    });
    // Another person is not affected, and the tracker settings row still reads as defaults.
    const other = await createTestUser(db, "Owen O");
    expect(await recordTestEmail(db, other.id, at(5 * 120_000))).toEqual({ allowed: true });
    expect(await getTrackerSettings(db, tess.id)).toEqual(await getTrackerSettings(db, other.id));
  });
});
