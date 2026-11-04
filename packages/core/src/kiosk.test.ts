import { describe, expect, it } from "vitest";

import {
  KIOSK_LOCK_MS,
  KIOSK_MAX_FAILURES,
  kioskActions,
  kioskState,
  parseQrPayload,
  PERSON_MAX_FAILURES,
  qrPayload,
  throttleUntil,
} from "./kiosk";

const MIN = 60_000;
const T0 = Date.parse("2026-11-04T08:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * MIN);
/** Failures at the given minutes, newest first (as the query returns them). */
const failures = (...minutes: number[]) =>
  minutes.map(at).sort((a, b) => b.getTime() - a.getTime());

const PERSON = { max: PERSON_MAX_FAILURES, windowMs: KIOSK_LOCK_MS, lockMs: KIOSK_LOCK_MS };
const KIOSK = { max: KIOSK_MAX_FAILURES, windowMs: KIOSK_LOCK_MS, lockMs: KIOSK_LOCK_MS };

describe("throttleUntil", () => {
  it("locks for 15 minutes from the fifth failure", () => {
    expect(throttleUntil(failures(0, 1, 2, 3, 4), PERSON, at(5))).toEqual(at(19));
  });

  it("is open once the lock has run out", () => {
    expect(throttleUntil(failures(0, 1, 2, 3, 4), PERSON, at(19))).toBeNull();
  });

  it("is open after four failures", () => {
    expect(throttleUntil(failures(0, 1, 2, 3), PERSON, at(5))).toBeNull();
  });

  it("is open when five failures are spread over 20 minutes", () => {
    expect(throttleUntil(failures(0, 5, 10, 15, 20), PERSON, at(21))).toBeNull();
  });

  it("locks a kiosk after 30 failures within 10 minutes, not after 29", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => i / 3);
    expect(throttleUntil(failures(...thirty), KIOSK, at(11))).not.toBeNull();
    expect(throttleUntil(failures(...thirty.slice(1)), KIOSK, at(11))).toBeNull();
  });
});

describe("kioskState and kioskActions", () => {
  it("reads the running entry", () => {
    expect(kioskState(null)).toBe("OUT");
    expect(kioskState({ type: "work" })).toBe("IN");
    expect(kioskState({ type: "break" })).toBe("BREAK");
  });

  it("offers the actions that fit the state", () => {
    expect(kioskActions("OUT", true)).toEqual(["CLOCK_IN"]);
    expect(kioskActions("IN", false)).toEqual(["CLOCK_OUT"]);
    expect(kioskActions("IN", true)).toEqual(["START_BREAK", "CLOCK_OUT"]);
    expect(kioskActions("BREAK", true)).toEqual(["END_BREAK", "CLOCK_OUT"]);
  });
});

describe("QR payload", () => {
  const token = "a".repeat(40) + "-_9";

  it("round-trips a 43-character token", () => {
    expect(parseQrPayload(qrPayload(token))).toBe(token);
  });

  it("ignores anything else", () => {
    expect(parseQrPayload("https://x")).toBeNull();
    expect(parseQrPayload("tkq1.short")).toBeNull();
    expect(parseQrPayload(`tkq1.${token}x`)).toBeNull();
  });
});
