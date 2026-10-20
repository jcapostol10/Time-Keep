import { describe, expect, it } from "vitest";

import { zoneNearNoon } from "./time-zones";

/** Vitest unit test of an e2e helper (Playwright ignores *.unit.test.ts). */
function localHour(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(
      instant,
    ),
  );
}

describe("zoneNearNoon", () => {
  it("puts every UTC hour of the day at 12:xx local time", () => {
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 59]) {
        const now = new Date(Date.UTC(2026, 0, 15, hour, minute));
        expect(localHour(now, zoneNearNoon(now)), `UTC ${hour}:${minute}`).toBe(12);
      }
    }
  });

  it("stays at noon in July, so no zone in the table observes daylight saving", () => {
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(Date.UTC(2026, 6, 15, hour, 30));
      expect(localHour(now, zoneNearNoon(now)), `UTC ${hour}:30`).toBe(12);
    }
  });

  it("only returns zones the app accepts", () => {
    const supported = new Set(Intl.supportedValuesOf("timeZone"));
    for (let hour = 0; hour < 24; hour++) {
      const zone = zoneNearNoon(new Date(Date.UTC(2026, 0, 15, hour)));
      expect(supported.has(zone), zone).toBe(true);
    }
  });
});
