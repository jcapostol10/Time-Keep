import { describe, expect, it } from "vitest";

import {
  approvalRulesOf,
  entryRulesOf,
  permissionSettingsOf,
  roundingRuleOf,
  type WorkspaceRuleColumns,
} from "./workspace-rules";

const WS = { id: "ws-1" };

function row(overrides: Partial<WorkspaceRuleColumns> = {}): WorkspaceRuleColumns {
  return {
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
    ...overrides,
  };
}

describe("permissionSettingsOf", () => {
  it("keeps only known pages and creator settings", () => {
    const settings = permissionSettingsOf(
      row({ hiddenPages: ["reports", "bogus"], projectCreators: "everyone", tagCreators: "nope" }),
      WS,
    );
    expect(settings.hiddenPages).toEqual(["reports"]);
    expect(settings.creators.project).toBe("everyone");
    expect(settings.creators.tag).toBe("admins");
    expect(settings.membersSeeTeamTime).toBe(false);
  });

  it("reads task visibility and falls back to everyone", () => {
    expect(permissionSettingsOf(row({ taskVisibility: "BY_GROUP" }), WS).taskVisibility).toBe(
      "BY_GROUP",
    );
    expect(permissionSettingsOf(row({ taskVisibility: "bogus" }), WS).taskVisibility).toBe(
      "EVERYONE",
    );
    expect(permissionSettingsOf(row(), WS).taskVisibility).toBe("EVERYONE");
  });

  it("passes force timer through the plan stub", () => {
    expect(permissionSettingsOf(row({ forceTimer: true }), WS).forceTimer).toBe(true);
    expect(permissionSettingsOf(row(), WS).forceTimer).toBe(false);
  });
});

describe("entryRulesOf", () => {
  it("keeps only known required fields", () => {
    expect(entryRulesOf(row({ requiredFields: ["task", "colour"], allowBreaks: true }))).toEqual({
      requiredFields: ["task"],
      allowBreaks: true,
    });
  });
});

describe("roundingRuleOf", () => {
  it("is null when off or when the step is not allowed", () => {
    expect(roundingRuleOf(row())).toBeNull();
    expect(roundingRuleOf(row({ roundingMode: "nearest", roundingMinutes: 7 }))).toBeNull();
    expect(roundingRuleOf(row({ roundingMode: "sideways", roundingMinutes: 15 }))).toBeNull();
  });

  it("returns the rule otherwise", () => {
    expect(roundingRuleOf(row({ roundingMode: "nearest", roundingMinutes: 15 }))).toEqual({
      mode: "nearest",
      minutes: 15,
    });
  });
});

describe("approvalReviewers", () => {
  it("reads the setting and falls back to admins", () => {
    expect(
      permissionSettingsOf(row({ approvalReviewers: "TEAM_MANAGERS" }), WS).approvalReviewers,
    ).toBe("TEAM_MANAGERS");
    expect(permissionSettingsOf(row({ approvalReviewers: "bogus" }), WS).approvalReviewers).toBe(
      "ADMINS",
    );
  });
});

describe("approvalRulesOf", () => {
  const zone = { timezone: "Asia/Manila", weekStart: 1 };

  it("passes the columns through in the workspace zone", () => {
    expect(
      approvalRulesOf(
        row({
          approvalEnabled: true,
          approvalPeriod: "SEMI_MONTHLY",
          lockMode: "ROLLING",
          lockDays: 7,
        }),
        zone,
      ),
    ).toEqual({
      enabled: true,
      period: { period: "SEMI_MONTHLY", timezone: "Asia/Manila", weekStart: 1 },
      lock: { mode: "ROLLING", date: null, days: 7, timezone: "Asia/Manila" },
    });
  });

  it("falls back on unknown strings", () => {
    const rules = approvalRulesOf(row({ approvalPeriod: "YEARLY", lockMode: "SOMETIMES" }), {
      timezone: "UTC",
      weekStart: 9,
    });
    expect(rules.period).toEqual({ period: "WEEKLY", timezone: "UTC", weekStart: 1 });
    expect(rules.lock.mode).toBe("OFF");
  });
});
