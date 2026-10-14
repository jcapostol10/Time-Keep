import { describe, expect, it } from "vitest";

import { validateEntryRange } from "./time-entry";

const now = new Date("2026-03-09T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("validateEntryRange", () => {
  it("rejects an end at or before the start", () => {
    expect(validateEntryRange({ start: now, end: now, now, mode: "manual" })).toEqual({
      ok: false,
      error: expect.stringMatching(/after/i),
    });
    expect(
      validateEntryRange({ start: now, end: at("2026-03-09T11:59:59Z"), now, mode: "manual" }).ok,
    ).toBe(false);
  });

  it("accepts a normal manual range, even in the future", () => {
    expect(
      validateEntryRange({
        start: at("2026-03-10T09:00:00Z"),
        end: at("2026-03-10T10:00:00Z"),
        now,
        mode: "manual",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects entries longer than 999 hours", () => {
    const start = at("2026-01-01T00:00:00Z");
    expect(
      validateEntryRange({
        start,
        end: new Date(start.getTime() + 999 * 3600_000),
        now,
        mode: "manual",
      }).ok,
    ).toBe(true);
    expect(
      validateEntryRange({
        start,
        end: new Date(start.getTime() + 999 * 3600_000 + 1000),
        now,
        mode: "manual",
      }),
    ).toEqual({ ok: false, error: expect.stringMatching(/999/) });
  });

  it("timer stops may not end more than a minute in the future", () => {
    const start = at("2026-03-09T11:00:00Z");
    expect(
      validateEntryRange({ start, end: at("2026-03-09T12:00:30Z"), now, mode: "timer-stop" }),
    ).toEqual({ ok: true });
    expect(
      validateEntryRange({ start, end: at("2026-03-09T12:01:01Z"), now, mode: "timer-stop" }),
    ).toEqual({ ok: false, error: expect.stringMatching(/future/i) });
  });
});
