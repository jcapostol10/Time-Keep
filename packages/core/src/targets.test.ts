import { describe, expect, it } from "vitest";
import { targetApplies, targetBreached, type TargetRule } from "./targets";

const rule = (extra: Partial<TargetRule> = {}): TargetRule => ({
  id: "t1",
  kind: "UNDER",
  period: "DAY",
  thresholdMinutes: 480,
  active: true,
  userIds: [],
  groupIds: [],
  ...extra,
});
const bob = { userId: "bob", groupIds: new Set(["cebu"]) };
const max = { userId: "max", groupIds: new Set<string>() };

describe("targetBreached", () => {
  it("is under when below the threshold", () => {
    expect(targetBreached(rule(), 28_799)).toBe(true);
    expect(targetBreached(rule(), 28_800)).toBe(false);
  });
  it("is over when above the threshold", () => {
    const over = rule({ kind: "OVER", thresholdMinutes: 600 });
    expect(targetBreached(over, 36_001)).toBe(true);
    expect(targetBreached(over, 36_000)).toBe(false);
  });
});

describe("targetApplies", () => {
  it("applies to everyone without assignees", () => {
    expect(targetApplies(rule(), max)).toBe(true);
  });
  it("applies to an assigned user", () => {
    expect(targetApplies(rule({ userIds: ["bob"] }), bob)).toBe(true);
    expect(targetApplies(rule({ userIds: ["bob"] }), max)).toBe(false);
  });
  it("applies to a member of an assigned group", () => {
    expect(targetApplies(rule({ groupIds: ["cebu"] }), bob)).toBe(true);
    expect(targetApplies(rule({ groupIds: ["cebu"] }), max)).toBe(false);
  });
  it("never applies while inactive", () => {
    expect(targetApplies(rule({ active: false }), bob)).toBe(false);
  });
});
