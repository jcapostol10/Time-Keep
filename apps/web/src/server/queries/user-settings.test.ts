import { DEFAULT_TRACKER_SETTINGS } from "@timekeep/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, truncateAll } from "../../../test/db";
import { getTrackerSettings, upsertTrackerSettings } from "./user-settings";

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
});
