import { describe, expect, it } from "vitest";

import { needsRerate, rateEffectiveFrom, type RateRow, resolveRate } from "./rates";

const FROM = new Date("2026-01-01T00:00:00Z");
const row = (over: Partial<RateRow>): RateRow => ({
  level: "workspace",
  userId: null,
  projectId: null,
  taskId: null,
  amountMinor: 1000,
  currency: "USD",
  effectiveFrom: FROM,
  ...over,
});

const ALL: RateRow[] = [
  row({ level: "workspace", amountMinor: 1000 }),
  row({ level: "member", userId: "ana", amountMinor: 2000 }),
  row({ level: "project", projectId: "web", amountMinor: 3000 }),
  row({ level: "project_member", projectId: "web", userId: "ana", amountMinor: 4000 }),
  row({ level: "task", projectId: "web", taskId: "design", amountMinor: 5000 }),
];
const at = new Date("2026-03-02T01:00:00Z");

describe("resolveRate", () => {
  it("lets the most specific level win: task, project member, project, member, workspace", () => {
    const ana = (projectId: string | null, taskId: string | null) =>
      resolveRate(ALL, { userId: "ana", projectId, taskId, start: at });
    expect(ana("web", "design")).toEqual({ amountMinor: 5000, currency: "USD", level: "task" });
    expect(ana("web", null)?.level).toBe("project_member");
    expect(
      resolveRate(ALL, { userId: "bob", projectId: "web", taskId: null, start: at })?.level,
    ).toBe("project");
    expect(ana("app", null)?.level).toBe("member");
    expect(
      resolveRate(ALL, { userId: "bob", projectId: null, taskId: null, start: at })?.level,
    ).toBe("workspace");
  });

  it("never applies a task rate to another project's entry", () => {
    const rates = [row({ level: "task", projectId: "web", taskId: "design", amountMinor: 5000 })];
    expect(
      resolveRate(rates, { userId: "ana", projectId: "app", taskId: "design", start: at }),
    ).toBeNull();
  });

  it("falls through a null row to the next level", () => {
    const rates = [
      ...ALL.filter((r) => r.level !== "project_member" && r.level !== "task"),
      row({
        level: "project",
        projectId: "web",
        amountMinor: null,
        effectiveFrom: new Date("2026-02-01T00:00:00Z"),
      }),
    ];
    expect(
      resolveRate(rates, { userId: "ana", projectId: "web", taskId: null, start: at }),
    ).toMatchObject({ amountMinor: 2000, level: "member" });
  });

  it("uses the latest row in force at the entry's start and ignores later ones", () => {
    const rates = [
      row({ level: "project", projectId: "web", amountMinor: 3000 }),
      row({
        level: "project",
        projectId: "web",
        amountMinor: 8000,
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
      }),
    ];
    const target = { userId: "ana", projectId: "web", taskId: null };
    expect(resolveRate(rates, { ...target, start: at })?.amountMinor).toBe(3000);
    expect(
      resolveRate(rates, { ...target, start: new Date("2026-04-01T00:00:00Z") })?.amountMinor,
    ).toBe(8000);
  });

  it("starts a rate at the effective day's midnight in the workspace's zone", () => {
    // Effective 2026-03-09 in Manila (UTC+8) = 2026-03-08T16:00Z.
    const from = rateEffectiveFrom("from", {
      date: "2026-03-09",
      timezone: "Asia/Manila",
      now: at,
    });
    expect(from.toISOString()).toBe("2026-03-08T16:00:00.000Z");
    const rates = [
      row({ level: "workspace", amountMinor: 1000 }),
      row({ level: "workspace", amountMinor: 9000, effectiveFrom: from }),
    ];
    const t = { userId: "ana", projectId: null, taskId: null };
    expect(resolveRate(rates, { ...t, start: new Date("2026-03-08T16:30:00Z") })?.amountMinor).toBe(
      9000,
    );
    expect(resolveRate(rates, { ...t, start: new Date("2026-03-08T15:59:00Z") })?.amountMinor).toBe(
      1000,
    );
  });

  it("returns null with no rate at all", () => {
    expect(resolveRate([], { userId: "ana", projectId: null, taskId: null, start: at })).toBeNull();
  });
});

describe("needsRerate", () => {
  const base = { userId: "ana", projectId: "web", taskId: null, billable: true };
  it("re-rates when what decides the rate changes, or billable is switched on", () => {
    expect(needsRerate(base, { ...base })).toBe(false);
    expect(needsRerate(base, { ...base, userId: "bob" })).toBe(true);
    expect(needsRerate(base, { ...base, projectId: "app" })).toBe(true);
    expect(needsRerate(base, { ...base, taskId: "design" })).toBe(true);
    expect(needsRerate({ ...base, billable: false }, base)).toBe(true);
    expect(needsRerate(base, { ...base, billable: false })).toBe(false);
  });
});

describe("rateEffectiveFrom", () => {
  it("is today's midnight for new entries, the date's for a date, and the beginning for all", () => {
    const now = new Date("2026-03-11T04:00:00Z"); // 12:00 in Manila
    expect(rateEffectiveFrom("new", { timezone: "Asia/Manila", now }).toISOString()).toBe(
      "2026-03-10T16:00:00.000Z",
    );
    expect(
      rateEffectiveFrom("from", { date: "2026-02-01", timezone: "UTC", now }).toISOString(),
    ).toBe("2026-02-01T00:00:00.000Z");
    expect(rateEffectiveFrom("all", { timezone: "UTC", now }).getTime()).toBe(0);
  });
});
