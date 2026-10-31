import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  type Action,
  type Actor,
  can,
  DEFAULT_PERMISSION_SETTINGS,
  denial,
  inScope,
  PERMISSION_MATRIX,
  type PermissionSettings,
  renderPermissionsMarkdown,
  type Resource,
} from "./permissions";
import { ROLES, type Role } from "./roles";

const ME = "u-me";
const MANAGED = "u-managed";
const OTHER = "u-other";
const MANAGED_PROJECT = "p-managed";
const OTHER_PROJECT = "p-other";
const MY_GROUP = "g-mine";
const OTHER_GROUP = "g-other";

function actor(role: Role, settings: Partial<PermissionSettings> = {}): Actor {
  const scoped = role === "manager";
  return {
    userId: ME,
    role,
    managedUserIds: new Set(scoped ? [MANAGED] : []),
    managedProjectIds: new Set(scoped ? [MANAGED_PROJECT] : []),
    groupIds: new Set([MY_GROUP]),
    settings: { ...DEFAULT_PERMISSION_SETTINGS, ...settings },
  };
}

const taskOn = (projectId: string, groupIds: string[] = []): Resource => ({
  kind: "task",
  projectId,
  groupIds,
});

const entry = (userId: string, projectId: string | null = OTHER_PROJECT): Resource => ({
  kind: "entry",
  userId,
  projectId,
});
const member = (userId: string, role: Role = "member"): Resource => ({
  kind: "member",
  userId,
  role,
});
const project = (projectId: string | null): Resource => ({ kind: "project", projectId });
const NONE: Resource = { kind: "none" };

type Row = [Action, Resource, owner: boolean, admin: boolean, manager: boolean, member: boolean];

// The expected answers, written out by hand: the test does not read the matrix.
const TABLE: Row[] = [
  ["workspace.update", { kind: "workspace" }, true, true, false, false],
  ["workspace.transferOwnership", { kind: "workspace" }, true, false, false, false],
  ["member.invite", NONE, true, true, false, false],
  ["member.changeRole", member(OTHER), true, true, false, false],
  ["member.changeRole", member(OTHER, "owner"), false, false, false, false],
  ["member.deactivate", member(OTHER), true, true, false, false],
  ["member.deactivate", member(OTHER, "owner"), false, false, false, false],
  ["member.deactivate", member(ME, "admin"), false, false, false, false],
  ["member.remove", member(OTHER), true, true, false, false],
  ["member.remove", member(OTHER, "owner"), false, false, false, false],
  ["member.remove", member(ME, "admin"), false, false, false, false],
  ["member.assignScope", member(OTHER, "manager"), true, true, false, false],
  ["group.manage", NONE, true, true, false, false],
  ["page.view", { kind: "page", page: "team" }, true, true, true, true],
  ["client.create", NONE, true, true, false, false],
  ["client.update", NONE, true, true, false, false],
  ["project.create", project(null), true, true, false, false],
  ["project.update", project(MANAGED_PROJECT), true, true, true, false],
  ["project.update", project(OTHER_PROJECT), true, true, false, false],
  ["project.delete", project(MANAGED_PROJECT), true, true, false, false],
  ["project.manageMembers", project(MANAGED_PROJECT), true, true, true, false],
  ["project.manageMembers", project(OTHER_PROJECT), true, true, false, false],
  [
    "project.view",
    { kind: "project", projectId: OTHER_PROJECT, visibility: "PUBLIC" },
    true,
    true,
    true,
    true,
  ],
  [
    "project.view",
    { kind: "project", projectId: OTHER_PROJECT, visibility: "PRIVATE", isMember: false },
    true,
    true,
    false,
    false,
  ],
  [
    "project.view",
    { kind: "project", projectId: OTHER_PROJECT, visibility: "PRIVATE", isMember: true },
    true,
    true,
    true,
    true,
  ],
  [
    "project.view",
    { kind: "project", projectId: MANAGED_PROJECT, visibility: "PRIVATE", isMember: false },
    true,
    true,
    true,
    false,
  ],
  ["task.create", taskOn(MANAGED_PROJECT), true, true, true, false],
  ["task.create", taskOn(OTHER_PROJECT), true, true, false, false],
  ["task.update", taskOn(MANAGED_PROJECT), true, true, true, false],
  ["task.update", taskOn(OTHER_PROJECT), true, true, false, false],
  ["task.assignGroups", taskOn(MANAGED_PROJECT), true, true, true, false],
  ["task.assignGroups", taskOn(OTHER_PROJECT), true, true, false, false],
  // Tasks are visible to everyone until the workspace shows them by group.
  ["task.trackTime", taskOn(OTHER_PROJECT), true, true, true, true],
  ["tag.create", NONE, true, true, false, false],
  ["tag.update", NONE, true, true, false, false],
  ["rate.view", NONE, true, true, false, false],
  ["rate.set", NONE, true, true, false, false],
  ["rate.recalculate", NONE, true, true, false, false],
  ["entry.read", entry(ME), true, true, true, true],
  ["entry.read", entry(MANAGED), true, true, true, false],
  ["entry.read", entry(OTHER, MANAGED_PROJECT), true, true, true, false],
  ["entry.read", entry(OTHER), true, true, false, false],
  ["entry.write", entry(ME), true, true, true, true],
  ["entry.write", entry(MANAGED), true, true, true, false],
  ["entry.write", entry(OTHER, MANAGED_PROJECT), true, true, false, false],
  ["entry.write", entry(OTHER), true, true, false, false],
  ["report.readTeam", NONE, true, true, true, false],
  ["report.viewAmounts", NONE, true, true, true, false],
  ["shareLink.manage", { kind: "shareLink", createdBy: ME }, true, true, true, true],
  ["shareLink.manage", { kind: "shareLink", createdBy: OTHER }, true, true, false, false],
  ["import.users", NONE, true, true, false, false],
  // Without force timer everyone may set times; "entry.write" decides whose.
  ["entry.writeTimes", entry(ME), true, true, true, true],
  ["import.entries", NONE, true, true, true, true],
];

describe("can", () => {
  it.each(TABLE)("%s on %o", (action, resource, ...expected) => {
    const answers = ROLES.map((role) => can(actor(role), action, resource));
    expect(answers).toEqual(expected);
  });

  it("covers every action in the table above", () => {
    const tested = new Set(TABLE.map(([action]) => action));
    expect(ACTIONS.filter((a) => !tested.has(a))).toEqual([]);
  });

  it("gives every action a rule for every role", () => {
    for (const action of ACTIONS) {
      expect(Object.keys(PERMISSION_MATRIX[action]).sort()).toEqual([...ROLES].sort());
    }
  });

  it("lets a manager with no assignments read only their own time", () => {
    const empty: Actor = {
      ...actor("manager"),
      managedUserIds: new Set(),
      managedProjectIds: new Set(),
    };
    expect(can(empty, "entry.read", entry(ME))).toBe(true);
    expect(can(empty, "entry.read", entry(MANAGED, MANAGED_PROJECT))).toBe(false);
    expect(can(empty, "project.update", project(MANAGED_PROJECT))).toBe(false);
  });
});

describe("denial", () => {
  it("is null when allowed", () => {
    expect(denial(actor("admin"), "rate.set", NONE)).toBeNull();
  });

  it("is 403 when the role may never act", () => {
    expect(denial(actor("member"), "rate.set", NONE)).toBe(403);
    expect(denial(actor("manager"), "rate.set", NONE)).toBe(403);
    expect(denial(actor("member"), "project.create", project(null))).toBe(403);
  });

  it("is 404 when the resource is outside the actor's scope", () => {
    expect(denial(actor("manager"), "entry.read", entry(OTHER))).toBe(404);
    expect(denial(actor("manager"), "project.update", project(OTHER_PROJECT))).toBe(404);
    expect(denial(actor("member"), "entry.write", entry(OTHER))).toBe(404);
    expect(
      denial(actor("member"), "project.view", {
        kind: "project",
        projectId: OTHER_PROJECT,
        visibility: "PRIVATE",
        isMember: false,
      }),
    ).toBe(404);
  });

  it("is 403 for acting on the owner or on yourself", () => {
    expect(denial(actor("admin"), "member.remove", member(OTHER, "owner"))).toBe(403);
    expect(denial(actor("admin"), "member.deactivate", member(ME, "admin"))).toBe(403);
  });
});

describe("inScope", () => {
  it("is own time, managed people, and anyone's time on managed projects", () => {
    const m = actor("manager");
    expect(inScope(m, { userId: ME, projectId: null })).toBe(true);
    expect(inScope(m, { userId: MANAGED, projectId: null })).toBe(true);
    expect(inScope(m, { userId: OTHER, projectId: MANAGED_PROJECT })).toBe(true);
    expect(inScope(m, { userId: OTHER, projectId: OTHER_PROJECT })).toBe(false);
  });
});

describe("workspace settings", () => {
  it("members see the team's time, never amounts, when the workspace allows it", () => {
    const m = actor("member", { membersSeeTeamTime: true });
    expect(can(m, "entry.read", entry(OTHER))).toBe(true);
    expect(can(m, "report.readTeam", NONE)).toBe(true);
    expect(can(m, "report.viewAmounts", NONE)).toBe(false);
    expect(can(m, "entry.write", entry(OTHER))).toBe(false);
  });

  it("creation follows the creators setting", () => {
    const everyone = {
      creators: { project: "everyone", client: "managers", tag: "admins" },
    } as const;
    expect(can(actor("member", everyone), "project.create", project(null))).toBe(true);
    expect(can(actor("member", everyone), "client.create", NONE)).toBe(false);
    expect(can(actor("manager", everyone), "client.create", NONE)).toBe(true);
    expect(can(actor("manager", everyone), "tag.create", NONE)).toBe(false);
    // Tasks left the setting (decision 11): admins and project managers only.
    expect(can(actor("member", everyone), "task.create", taskOn(OTHER_PROJECT))).toBe(false);
    expect(can(actor("manager", everyone), "task.create", taskOn(OTHER_PROJECT))).toBe(false);
    expect(can(actor("manager", everyone), "task.create", taskOn(MANAGED_PROJECT))).toBe(true);
  });

  it("force timer blocks members' and managers' own times, never time for someone else", () => {
    const forced = { forceTimer: true };
    expect(can(actor("member"), "entry.writeTimes", entry(ME))).toBe(true);
    expect(can(actor("member", forced), "entry.writeTimes", entry(ME))).toBe(false);
    expect(denial(actor("member", forced), "entry.writeTimes", entry(ME))).toBe(403);
    expect(can(actor("manager", forced), "entry.writeTimes", entry(ME))).toBe(false);
    expect(can(actor("manager", forced), "entry.writeTimes", entry(MANAGED))).toBe(true);
    expect(can(actor("admin", forced), "entry.writeTimes", entry(ME))).toBe(true);
    expect(can(actor("owner", forced), "entry.writeTimes", entry(OTHER))).toBe(true);
  });

  it("a hidden page is closed to members only", () => {
    const hidden = { hiddenPages: ["reports" as const] };
    expect(can(actor("member", hidden), "page.view", { kind: "page", page: "reports" })).toBe(
      false,
    );
    expect(denial(actor("member", hidden), "page.view", { kind: "page", page: "reports" })).toBe(
      403,
    );
    expect(can(actor("member", hidden), "page.view", { kind: "page", page: "team" })).toBe(true);
    expect(can(actor("manager", hidden), "page.view", { kind: "page", page: "reports" })).toBe(
      true,
    );
  });
});

describe("tasks by group", () => {
  const byGroup = { taskVisibility: "BY_GROUP" } as const;
  const inTwoGroups = (role: Role): Actor => ({
    ...actor(role, byGroup),
    groupIds: new Set([MY_GROUP, "g-two"]),
  });
  const inNoGroup = (role: Role): Actor => ({ ...actor(role, byGroup), groupIds: new Set() });

  type Case = [title: string, actor: Actor, resource: Resource, allowed: boolean];
  const CASES: Case[] = [
    [
      "a member on a task of their group",
      actor("member", byGroup),
      taskOn(OTHER_PROJECT, [MY_GROUP]),
      true,
    ],
    [
      "a member in two groups on a task of the second",
      inTwoGroups("member"),
      taskOn(OTHER_PROJECT, ["g-two"]),
      true,
    ],
    [
      "a member on a task of another group",
      actor("member", byGroup),
      taskOn(OTHER_PROJECT, [OTHER_GROUP]),
      false,
    ],
    ["a member who left the group", inNoGroup("member"), taskOn(OTHER_PROJECT, [MY_GROUP]), false],
    ["a member on a task with no group", actor("member", byGroup), taskOn(OTHER_PROJECT), false],
    [
      "a manager on a managed project's task of another group",
      actor("manager", byGroup),
      taskOn(MANAGED_PROJECT, [OTHER_GROUP]),
      true,
    ],
    [
      "a manager on another project's task of another group",
      actor("manager", byGroup),
      taskOn(OTHER_PROJECT, [OTHER_GROUP]),
      false,
    ],
    [
      "a manager on another project's task of their own group",
      actor("manager", byGroup),
      taskOn(OTHER_PROJECT, [MY_GROUP]),
      true,
    ],
    [
      "a manager on a managed project's task with no group",
      actor("manager", byGroup),
      taskOn(MANAGED_PROJECT),
      true,
    ],
    ["an owner on a task with no group", actor("owner", byGroup), taskOn(OTHER_PROJECT), true],
    ["an admin on a task with no group", actor("admin", byGroup), taskOn(OTHER_PROJECT), true],
    [
      "a member in no group at all",
      inNoGroup("member"),
      taskOn(OTHER_PROJECT, [OTHER_GROUP]),
      false,
    ],
  ];

  it.each(CASES)("%s", (_title, who, resource, allowed) => {
    expect(can(who, "task.trackTime", resource)).toBe(allowed);
  });

  it("refuses with 404: the task's groups are the resource, not the role", () => {
    const m = actor("member", byGroup);
    expect(denial(m, "task.trackTime", taskOn(OTHER_PROJECT, [OTHER_GROUP]))).toBe(404);
    expect(denial(m, "task.trackTime", taskOn(OTHER_PROJECT, [MY_GROUP]))).toBeNull();
  });

  it("is open to everyone while the workspace shows tasks to everyone", () => {
    const m = inNoGroup("member");
    m.settings = { ...m.settings, taskVisibility: "EVERYONE" };
    expect(can(m, "task.trackTime", taskOn(OTHER_PROJECT, [OTHER_GROUP]))).toBe(true);
    expect(can(m, "task.trackTime", taskOn(OTHER_PROJECT))).toBe(true);
  });

  it("documents the rule", () => {
    expect(renderPermissionsMarkdown()).toContain("`task.trackTime`");
    expect(renderPermissionsMarkdown()).toContain("`task.assignGroups`");
  });
});

describe("renderPermissionsMarkdown", () => {
  it("renders a table per resource with a column per role", () => {
    const md = renderPermissionsMarkdown();
    expect(md).toContain("| Action | Owner | Admin | Manager | Member |");
    for (const action of ACTIONS) expect(md).toContain(`\`${action}\``);
  });
});
