import { describe, expect, it } from "vitest";

import {
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
