import { describe, expect, it } from "vitest";

import { TEST_EMAIL_LIMIT, testEmailAllowance } from "./test-email";

const now = new Date("2026-10-22T10:00:00.000Z");
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000);

describe("testEmailAllowance", () => {
  it("allows the first one, and counts it", () => {
    expect(testEmailAllowance({ lastSentAt: null, countInDay: 0, now })).toEqual({
      allowed: true,
      countInDay: 1,
    });
  });

  it("refuses a second one within a minute, saying how long to wait", () => {
    expect(testEmailAllowance({ lastSentAt: minutesAgo(0.5), countInDay: 1, now })).toEqual({
      allowed: false,
      reason: "You can send another test email in 30 seconds.",
    });
    expect(testEmailAllowance({ lastSentAt: minutesAgo(2), countInDay: 1, now })).toEqual({
      allowed: true,
      countInDay: 2,
    });
  });

  it("stops at the daily limit, which resets a day after the last send", () => {
    expect(TEST_EMAIL_LIMIT).toEqual({ perDay: 5, minSecondsBetween: 60 });
    expect(testEmailAllowance({ lastSentAt: hoursAgo(1), countInDay: 5, now })).toEqual({
      allowed: false,
      reason: "That is 5 test emails today; try again tomorrow.",
    });
    expect(testEmailAllowance({ lastSentAt: hoursAgo(25), countInDay: 5, now })).toEqual({
      allowed: true,
      countInDay: 1,
    });
  });
});
