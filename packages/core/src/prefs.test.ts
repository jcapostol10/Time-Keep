import { describe, expect, it } from "vitest";

import { resolveViewerPrefs } from "./prefs";

const workspace = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  durationFormat: "hh:mm",
  weekStart: 1,
} as const;

describe("resolveViewerPrefs", () => {
  it("falls back to the workspace when the user has no preference", () => {
    expect(
      resolveViewerPrefs(
        { timezone: null, timeFormat: null, dateFormat: null, weekStart: null },
        workspace,
      ),
    ).toEqual({
      timezone: "Asia/Manila",
      timeFormat: "24h",
      dateFormat: "MM/dd/yyyy",
      weekStart: 1,
      durationFormat: "hh:mm",
    });
  });

  it("prefers the user's own settings", () => {
    expect(
      resolveViewerPrefs(
        { timezone: "America/New_York", timeFormat: "12h", dateFormat: "yyyy-MM-dd", weekStart: 0 },
        workspace,
      ),
    ).toEqual({
      timezone: "America/New_York",
      timeFormat: "12h",
      dateFormat: "yyyy-MM-dd",
      weekStart: 0,
      durationFormat: "hh:mm",
    });
  });

  it("ignores invalid user values and tolerates missing fields", () => {
    expect(resolveViewerPrefs({ timeFormat: "13h", weekStart: 9 }, workspace)).toMatchObject({
      timezone: "Asia/Manila",
      timeFormat: "24h",
      weekStart: 1,
    });
    expect(resolveViewerPrefs({}, workspace).durationFormat).toBe("hh:mm");
  });

  it("falls back to UTC when the workspace zone is unknown", () => {
    expect(resolveViewerPrefs({}, { ...workspace, timezone: "Mars/Olympus" }).timezone).toBe("UTC");
  });
});
