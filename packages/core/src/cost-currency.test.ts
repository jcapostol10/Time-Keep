import { describe, expect, it } from "vitest";

import { currencyCodes, isCurrencyCode } from "./money";
import {
  type Actor,
  can,
  DEFAULT_PERMISSION_SETTINGS,
  type PermissionSettings,
} from "./permissions";
import {
  COST_LEVELS,
  entryCurrency,
  needsCostRerate,
  type RateRow,
  type RateTarget,
  resolveRate,
} from "./rates";
import { addTotals, EMPTY_TOTALS, hideCosts, marginPercent, mergeAmounts } from "./reports";
import type { Role } from "./roles";
import { clientInputSchema, setRateSchema } from "./schemas";
import { permissionSettingsOf, type WorkspaceRuleColumns } from "./workspace-rules";

// Phase 6a: cost rates, the entry's currency, totals per currency, report.viewCosts.

const FROM = new Date("2026-01-01T00:00:00Z");
const at = new Date("2026-03-02T01:00:00Z");
const row = (over: Partial<RateRow>): RateRow => ({
  kind: "billable",
  level: "workspace",
  userId: null,
  projectId: null,
  taskId: null,
  amountMinor: 1000,
  currency: "PHP",
  effectiveFrom: FROM,
  ...over,
});
const target = (over: Partial<RateTarget> = {}): RateTarget => ({
  userId: "ana",
  projectId: "web",
  taskId: null,
  start: at,
  currency: "PHP",
  ...over,
});

describe("a billable rate applies in its own currency", () => {
  const rates = [
    row({ level: "member", userId: "ana", amountMinor: 250_000, currency: "PHP" }),
    row({ level: "project", projectId: "web", amountMinor: 4000, currency: "USD" }),
  ];

  it("skips a rate in another currency", () => {
    expect(resolveRate(rates, target({ currency: "USD" }))).toEqual({
      amountMinor: 4000,
      currency: "USD",
      level: "project",
    });
    expect(resolveRate(rates, target({ currency: "PHP" }))).toEqual({
      amountMinor: 250_000,
      currency: "PHP",
      level: "member",
    });
  });

  it("leaves an entry in a foreign currency unrated when only member and workspace rates exist", () => {
    const local = [
      row({ level: "member", userId: "ana", amountMinor: 250_000 }),
      row({ level: "workspace", amountMinor: 100_000 }),
    ];
    expect(resolveRate(local, target({ currency: "USD" }))).toBeNull();
  });

  it("never reads a cost row as a billable rate", () => {
    const cost = [row({ kind: "cost", level: "member", userId: "ana", amountMinor: 90_000 })];
    expect(resolveRate(cost, target())).toBeNull();
  });
});

describe("cost rates", () => {
  const cost = (over: Partial<RateRow>) => row({ kind: "cost", ...over });

  it("has two levels, project member before member", () => {
    expect(COST_LEVELS).toEqual(["project_member", "member"]);
    const rates = [
      cost({ level: "member", userId: "ana", amountMinor: 60_000 }),
      cost({ level: "project_member", userId: "ana", projectId: "web", amountMinor: 80_000 }),
    ];
    expect(resolveRate(rates, target(), "cost")).toEqual({
      amountMinor: 80_000,
      currency: "PHP",
      level: "project_member",
    });
    expect(resolveRate(rates, target({ projectId: "app" }), "cost")?.level).toBe("member");
    expect(resolveRate(rates, target({ userId: "bob" }), "cost")).toBeNull();
  });

  it("lets a null row fall through to the member", () => {
    const rates = [
      cost({ level: "member", userId: "ana", amountMinor: 60_000 }),
      cost({ level: "project_member", userId: "ana", projectId: "web", amountMinor: null }),
    ];
    expect(resolveRate(rates, target(), "cost")?.amountMinor).toBe(60_000);
  });

  it("ignores task, project and workspace rows, and billable rows", () => {
    const rates = [
      cost({ level: "workspace", amountMinor: 1 }),
      cost({ level: "project", projectId: "web", amountMinor: 2 }),
      cost({ level: "task", projectId: "web", taskId: "design", amountMinor: 3 }),
      row({ level: "member", userId: "ana", amountMinor: 250_000 }),
    ];
    expect(resolveRate(rates, target({ taskId: "design" }), "cost")).toBeNull();
  });

  it("uses the row in force at the entry's start", () => {
    const rates = [
      cost({ level: "member", userId: "ana", amountMinor: 60_000 }),
      cost({
        level: "member",
        userId: "ana",
        amountMinor: 70_000,
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
      }),
    ];
    expect(resolveRate(rates, target(), "cost")?.amountMinor).toBe(60_000);
    expect(
      resolveRate(rates, target({ start: new Date("2026-04-02T00:00:00Z") }), "cost")?.amountMinor,
    ).toBe(70_000);
  });

  it("is in the workspace currency whatever the entry's currency is", () => {
    const rates = [cost({ level: "member", userId: "ana", amountMinor: 60_000, currency: "PHP" })];
    expect(resolveRate(rates, target({ currency: "USD" }), "cost")?.amountMinor).toBe(60_000);
  });

  it("is re-rated by a new person or project, not by a task or billable", () => {
    const base = { userId: "ana", projectId: "web", taskId: null, billable: false };
    expect(needsCostRerate(base, { ...base, userId: "bob" })).toBe(true);
    expect(needsCostRerate(base, { ...base, projectId: "app" })).toBe(true);
    expect(needsCostRerate(base, { ...base, projectId: null })).toBe(true);
    expect(needsCostRerate(base, { ...base, taskId: "design" })).toBe(false);
    expect(needsCostRerate(base, { ...base, billable: true })).toBe(false);
    expect(needsCostRerate(base, base)).toBe(false);
  });
});

describe("entryCurrency", () => {
  it("takes the client's currency, else the workspace's", () => {
    expect(entryCurrency("USD", "PHP")).toBe("USD");
    expect(entryCurrency(null, "PHP")).toBe("PHP");
    expect(entryCurrency(undefined, "PHP")).toBe("PHP");
    expect(entryCurrency("", "PHP")).toBe("PHP");
  });
});

describe("currency codes", () => {
  it("knows ISO 4217 codes and refuses the rest", () => {
    expect(isCurrencyCode("PHP")).toBe(true);
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("php")).toBe(false);
    expect(isCurrencyCode("ZZZ")).toBe(false);
    expect(isCurrencyCode("")).toBe(false);
  });

  it("lists them sorted", () => {
    const codes = currencyCodes();
    for (const code of ["EUR", "JPY", "PHP", "USD"]) expect(codes).toContain(code);
    expect([...codes].sort()).toEqual(codes);
  });
});

describe("totals per currency", () => {
  it("keeps currencies apart when adding", () => {
    const a = {
      ...EMPTY_TOTALS,
      amountMinor: 100,
      otherAmounts: [{ currency: "USD", amountMinor: 500 }],
      costMinor: 40,
      uncostedCount: 1,
      profitMinor: 60,
      profitExcludedCount: 2,
    };
    const b = {
      ...EMPTY_TOTALS,
      amountMinor: 50,
      otherAmounts: [
        { currency: "USD", amountMinor: 1 },
        { currency: "EUR", amountMinor: 20 },
      ],
      costMinor: 10,
      uncostedCount: 0,
      profitMinor: 40,
      profitExcludedCount: 1,
    };
    expect(addTotals(a, b)).toEqual({
      ...EMPTY_TOTALS,
      amountMinor: 150,
      otherAmounts: [
        { currency: "EUR", amountMinor: 20 },
        { currency: "USD", amountMinor: 501 },
      ],
      costMinor: 50,
      uncostedCount: 1,
      profitMinor: 100,
      profitExcludedCount: 3,
    });
    expect(EMPTY_TOTALS).toMatchObject({ otherAmounts: [], costMinor: 0, profitMinor: 0 });
  });

  it("merges amount lists by currency, sorted by code, without touching its inputs", () => {
    const a = [{ currency: "USD", amountMinor: 5 }];
    const b = [
      { currency: "USD", amountMinor: 7 },
      { currency: "AUD", amountMinor: 1 },
    ];
    expect(mergeAmounts(a, b)).toEqual([
      { currency: "AUD", amountMinor: 1 },
      { currency: "USD", amountMinor: 12 },
    ]);
    expect(a).toEqual([{ currency: "USD", amountMinor: 5 }]);
  });

  it("gives the margin as a percent with one decimal, or null without an amount", () => {
    expect(marginPercent({ amountMinor: 20_000, profitMinor: 5000 })).toBe(25);
    expect(marginPercent({ amountMinor: 3, profitMinor: 1 })).toBe(33.3);
    expect(marginPercent({ amountMinor: 1000, profitMinor: -250 })).toBe(-25);
    expect(marginPercent({ amountMinor: 0, profitMinor: -250 })).toBeNull();
  });

  it("hides cost and profit and keeps time and amounts", () => {
    const t = {
      ...EMPTY_TOTALS,
      durationSeconds: 3600,
      amountMinor: 100,
      otherAmounts: [{ currency: "USD", amountMinor: 500 }],
      costMinor: 40,
      uncostedCount: 1,
      profitMinor: 60,
      profitExcludedCount: 2,
    };
    expect(hideCosts(t)).toEqual({
      ...t,
      costMinor: 0,
      uncostedCount: 0,
      profitMinor: 0,
      profitExcludedCount: 0,
    });
  });
});

describe("report.viewCosts", () => {
  const NONE = { kind: "none" } as const;
  const actor = (role: Role, settings: Partial<PermissionSettings> = {}): Actor => ({
    userId: "me",
    role,
    managedUserIds: new Set(),
    managedProjectIds: new Set(),
    groupIds: new Set(),
    settings: { ...DEFAULT_PERMISSION_SETTINGS, ...settings },
  });

  it("is for owners and admins, and for managers only when the workspace says so", () => {
    expect(DEFAULT_PERMISSION_SETTINGS.managersSeeCosts).toBe(false);
    expect(can(actor("owner"), "report.viewCosts", NONE)).toBe(true);
    expect(can(actor("admin"), "report.viewCosts", NONE)).toBe(true);
    expect(can(actor("manager"), "report.viewCosts", NONE)).toBe(false);
    expect(can(actor("manager", { managersSeeCosts: true }), "report.viewCosts", NONE)).toBe(true);
  });

  it("is never for members", () => {
    expect(can(actor("member"), "report.viewCosts", NONE)).toBe(false);
    expect(
      can(
        actor("member", { managersSeeCosts: true, membersSeeTeamTime: true }),
        "report.viewCosts",
        NONE,
      ),
    ).toBe(false);
  });

  it("reads the setting from the workspace row", () => {
    const columns: WorkspaceRuleColumns = {
      hiddenPages: [],
      membersSeeTeamTime: false,
      projectCreators: "admins",
      clientCreators: "admins",
      tagCreators: "admins",
      forceTimer: false,
      requiredFields: [],
      allowBreaks: false,
      roundingMode: "off",
      roundingMinutes: 15,
      taskVisibility: "EVERYONE",
      approvalEnabled: false,
      approvalPeriod: "WEEKLY",
      approvalReviewers: "ADMINS",
      lockMode: "OFF",
      lockDate: null,
      lockDays: null,
      managersSeeCosts: true,
    };
    expect(permissionSettingsOf(columns, { id: "ws" }).managersSeeCosts).toBe(true);
    expect(
      permissionSettingsOf({ ...columns, managersSeeCosts: false }, { id: "ws" }).managersSeeCosts,
    ).toBe(false);
  });
});

describe("schemas", () => {
  const rate = { amount: "500", apply: "new" as const };

  it("takes a cost rate per member or per project member only", () => {
    expect(setRateSchema.parse({ ...rate, level: "member", userId: "u" }).kind).toBe("billable");
    expect(
      setRateSchema.safeParse({ ...rate, kind: "cost", level: "member", userId: "u" }).success,
    ).toBe(true);
    expect(
      setRateSchema.safeParse({
        ...rate,
        kind: "cost",
        level: "project_member",
        userId: "u",
        projectId: "p",
      }).success,
    ).toBe(true);
    for (const level of ["task", "project", "workspace"] as const) {
      const parsed = setRateSchema.safeParse({ ...rate, kind: "cost", level, projectId: "p" });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(
        "Cost rates are per member or per project member.",
      );
    }
  });

  it("takes a real currency code for a client, or none", () => {
    expect(clientInputSchema.safeParse({ name: "Acme", currency: "USD" }).success).toBe(true);
    expect(clientInputSchema.safeParse({ name: "Acme", currency: null }).success).toBe(true);
    expect(clientInputSchema.safeParse({ name: "Acme", currency: "usd" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ name: "Acme", currency: "ZZZ" }).success).toBe(false);
  });
});
