import { describe, expect, it } from "vitest";

import {
  currencyCodeSchema,
  inviteMemberSchema,
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
