import { describe, expect, it } from "vitest";
import { holidayApplies, holidayKeysFor, holidaysInRange, type HolidayRule } from "./holidays";

const rule = (extra: Partial<HolidayRule>): HolidayRule => ({
  id: "h1",
  date: "2026-12-25",
  name: "Christmas Day",
  repeatsYearly: false,
  userIds: [],
  groupIds: [],
  ...extra,
});
const bob = { userId: "bob", groupIds: new Set(["cebu"]) };
const max = { userId: "max", groupIds: new Set<string>() };

describe("holidayApplies", () => {
  it("applies a workspace-wide holiday to anyone", () => {
    expect(holidayApplies(rule({}), max)).toBe(true);
  });
  it("applies a user-assigned holiday only to that user", () => {
    const h = rule({ userIds: ["bob"] });
    expect(holidayApplies(h, bob)).toBe(true);
    expect(holidayApplies(h, max)).toBe(false);
  });
  it("applies a group-assigned holiday to a member of the group", () => {
    const h = rule({ groupIds: ["cebu"] });
    expect(holidayApplies(h, bob)).toBe(true);
    expect(holidayApplies(h, max)).toBe(false);
  });
});

describe("holidaysInRange", () => {
  it("repeats a yearly holiday in every year of the range", () => {
    const got = holidaysInRange([rule({ repeatsYearly: true })], "2026-12-01", "2027-12-31");
    expect(got.map((g) => g.dateKey)).toEqual(["2026-12-25", "2027-12-25"]);
  });
  it("repeats 29 February only in leap years", () => {
    const leap = rule({ date: "2024-02-29", repeatsYearly: true });
    expect(holidaysInRange([leap], "2027-01-01", "2027-12-31")).toEqual([]);
    expect(holidaysInRange([leap], "2028-01-01", "2028-12-31").map((g) => g.dateKey)).toEqual([
      "2028-02-29",
    ]);
  });
  it("keeps a one-off holiday on its own date only", () => {
    expect(holidaysInRange([rule({})], "2027-01-01", "2027-12-31")).toEqual([]);
    expect(holidaysInRange([rule({})], "2026-12-25", "2026-12-25")).toHaveLength(1);
  });
  it("never repeats a yearly holiday before its first year", () => {
    expect(holidaysInRange([rule({ repeatsYearly: true })], "2025-01-01", "2025-12-31")).toEqual(
      [],
    );
  });
});

describe("holidayKeysFor", () => {
  it("keeps only the holidays that apply to the person", () => {
    const hs = [rule({ id: "a" }), rule({ id: "b", date: "2026-12-30", groupIds: ["cebu"] })];
    expect([...holidayKeysFor(hs, bob, "2026-12-01", "2026-12-31")]).toEqual([
      "2026-12-25",
      "2026-12-30",
    ]);
    expect([...holidayKeysFor(hs, max, "2026-12-01", "2026-12-31")]).toEqual(["2026-12-25"]);
  });
});
