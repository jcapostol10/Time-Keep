import type { ProjectVisibility } from "./catalog";
import { ROLE_LABELS, ROLES, type Role } from "./roles";

/**
 * The permission matrix: who may do what, in one table. Every server action,
 * route handler and hideable page asks `can` (through `authorize` on the
 * server); `docs/PERMISSIONS.md` is generated from this file
 * (`pnpm permissions:doc`).
 *
 * A manager's scope is the people they manage (directly or through groups)
 * and the projects they manage; the server loads both into the `Actor`.
 */

export const PAGES = ["projects", "team", "reports"] as const;
export type Page = (typeof PAGES)[number];

export const ACTIONS = [
  "workspace.update",
  "workspace.transferOwnership",
  "member.invite",
  "member.changeRole",
  "member.deactivate",
  "member.remove",
  "member.assignScope",
  "group.manage",
  "page.view",
  "client.create",
  "client.update",
  "project.create",
  "project.view",
  "project.update",
  "project.delete",
  "project.manageMembers",
  "task.create",
  "task.update",
  /** set or change a task's groups (decision 11) */
  "task.assignGroups",
  /** track time on a task: open to all, or by group when the workspace says so */
  "task.trackTime",
  "tag.create",
  "tag.update",
  "rate.view",
  "rate.set",
  "rate.recalculate",
  "entry.read",
  "entry.write",
  "report.readTeam",
  "report.viewAmounts",
  "shareLink.manage",
  "import.users",
  /** start, end or duration by hand: the force-timer gate */
  "entry.writeTimes",
  "import.entries",
] as const;
export type Action = (typeof ACTIONS)[number];

export const CREATOR_SETTINGS = ["admins", "managers", "everyone"] as const;
export type CreatorSetting = (typeof CREATOR_SETTINGS)[number];

/** Who sees a task: everyone (today's behaviour) or only the members of its groups. */
export const TASK_VISIBILITY = ["EVERYONE", "BY_GROUP"] as const;
export type TaskVisibility = (typeof TASK_VISIBILITY)[number];
/** What "who can create" covers; tasks are always admins and project managers (decision 11). */
export type CatalogType = "project" | "client" | "tag";

/** The workspace switches that change answers (Phase 4b makes them editable). */
export interface PermissionSettings {
  hiddenPages: Page[];
  membersSeeTeamTime: boolean;
  creators: Record<CatalogType, CreatorSetting>;
  forceTimer: boolean;
  taskVisibility: TaskVisibility;
}

/** Today's behaviour: nothing hidden, members see their own time, admins create the catalog. */
export const DEFAULT_PERMISSION_SETTINGS: PermissionSettings = {
  hiddenPages: [],
  membersSeeTeamTime: false,
  creators: { project: "admins", client: "admins", tag: "admins" },
  forceTimer: false,
  taskVisibility: "EVERYONE",
};

export interface Actor {
  userId: string;
  role: Role;
  managedUserIds: ReadonlySet<string>;
  managedProjectIds: ReadonlySet<string>;
  /** The groups the actor belongs to in this workspace (loaded when tasks are by group). */
  groupIds: ReadonlySet<string>;
  settings: PermissionSettings;
}

export type Resource =
  | { kind: "none" }
  | { kind: "workspace" }
  | { kind: "page"; page: Page }
  | { kind: "member"; userId: string; role: Role }
  | {
      kind: "project";
      /** null when the project is being created */
      projectId: string | null;
      visibility?: ProjectVisibility;
      /** the actor is on the project's member list */
      isMember?: boolean;
    }
  | {
      kind: "task";
      projectId: string;
      /** the task's groups, for `task.trackTime` (absent while the task is being created) */
      groupIds?: readonly string[];
    }
  | { kind: "entry"; userId: string; projectId: string | null }
  | { kind: "shareLink"; createdBy: string };

/**
 * How a role's answer is decided. Rules that read the role or the workspace
 * settings deny with 403; rules that read the resource deny with 404, so a
 * manager cannot learn that something outside their scope exists.
 */
export type Rule =
  | "yes"
  | "no"
  /** the resource belongs to the actor */
  | "own"
  /** own, or anyone's when the workspace lets members see team time */
  | "ownOrTeam"
  /** own time, the people they manage, anyone's time on the projects they manage */
  | "scope"
  /** own time and the people they manage */
  | "managedPeople"
  /** the projects they manage */
  | "managedProjects"
  /** public, on the project's members, or managed */
  | "visible"
  /** the workspace's "who can create" setting allows the role */
  | "creator"
  /** allowed unless the workspace hides the page from members */
  | "unlessHidden"
  /** allowed when the workspace lets members see team time */
  | "teamSetting"
  /** allowed unless force timer is on, and then only for someone else's time */
  | "unlessForced"
  /** every task, or when tasks are by group: the tasks of their groups and of projects they manage */
  | "taskGroups";

const SCOPED: ReadonlySet<Rule> = new Set([
  "own",
  "ownOrTeam",
  "scope",
  "managedPeople",
  "managedProjects",
  "visible",
  "taskGroups",
]);

const ADMINS = { owner: "yes", admin: "yes", manager: "no", member: "no" } as const;
const OWNER_ONLY = { owner: "yes", admin: "no", manager: "no", member: "no" } as const;
const CREATOR = { owner: "yes", admin: "yes", manager: "creator", member: "creator" } as const;
const PROJECT_MANAGERS = {
  owner: "yes",
  admin: "yes",
  manager: "managedProjects",
  member: "no",
} as const;

export const PERMISSION_MATRIX: Record<Action, Record<Role, Rule>> = {
  "workspace.update": ADMINS,
  "workspace.transferOwnership": OWNER_ONLY,
  "member.invite": ADMINS,
  "member.changeRole": ADMINS,
  "member.deactivate": ADMINS,
  "member.remove": ADMINS,
  "member.assignScope": ADMINS,
  "group.manage": ADMINS,
  "page.view": { owner: "yes", admin: "yes", manager: "yes", member: "unlessHidden" },
  "client.create": CREATOR,
  "client.update": ADMINS,
  "project.create": CREATOR,
  "project.view": { owner: "yes", admin: "yes", manager: "visible", member: "visible" },
  "project.update": PROJECT_MANAGERS,
  "project.delete": ADMINS,
  "project.manageMembers": PROJECT_MANAGERS,
  "task.create": PROJECT_MANAGERS,
  "task.update": PROJECT_MANAGERS,
  "task.assignGroups": PROJECT_MANAGERS,
  "task.trackTime": { owner: "yes", admin: "yes", manager: "taskGroups", member: "taskGroups" },
  "tag.create": CREATOR,
  "tag.update": ADMINS,
  "rate.view": ADMINS,
  "rate.set": ADMINS,
  "rate.recalculate": ADMINS,
  "entry.read": { owner: "yes", admin: "yes", manager: "scope", member: "ownOrTeam" },
  "entry.write": { owner: "yes", admin: "yes", manager: "managedPeople", member: "own" },
  "report.readTeam": { owner: "yes", admin: "yes", manager: "yes", member: "teamSetting" },
  "report.viewAmounts": { owner: "yes", admin: "yes", manager: "yes", member: "no" },
  "shareLink.manage": { owner: "yes", admin: "yes", manager: "own", member: "own" },
  "import.users": ADMINS,
  "entry.writeTimes": { owner: "yes", admin: "yes", manager: "unlessForced", member: "unlessForced" },
  "import.entries": { owner: "yes", admin: "yes", manager: "yes", member: "yes" },
};

const CREATED: Partial<Record<Action, CatalogType>> = {
  "client.create": "client",
  "project.create": "project",
  "tag.create": "tag",
};

/** Actions on a member that can never target the owner, nor the actor themselves. */
const MEMBER_GUARDED: ReadonlySet<Action> = new Set([
  "member.changeRole",
  "member.deactivate",
  "member.remove",
]);

/** Own time, people they manage, and anyone's time on projects they manage. */
export function inScope(
  actor: Actor,
  entry: { userId: string; projectId: string | null },
): boolean {
  return (
    entry.userId === actor.userId ||
    actor.managedUserIds.has(entry.userId) ||
    (entry.projectId !== null && actor.managedProjectIds.has(entry.projectId))
  );
}

function ownerOf(resource: Resource): string | null {
  switch (resource.kind) {
    case "entry":
    case "member":
      return resource.userId;
    case "shareLink":
      return resource.createdBy;
    default:
      return null;
  }
}

function projectOf(resource: Resource): string | null {
  if (resource.kind === "project" || resource.kind === "task" || resource.kind === "entry") {
    return resource.projectId;
  }
  return null;
}

function allowsRole(setting: CreatorSetting, role: Role): boolean {
  if (setting === "everyone") return true;
  if (setting === "managers") return role !== "member";
  return role === "owner" || role === "admin";
}

function check(actor: Actor, action: Action, rule: Rule, resource: Resource): boolean {
  const projectId = projectOf(resource);
  switch (rule) {
    case "yes":
      return true;
    case "no":
      return false;
    case "own":
      return ownerOf(resource) === actor.userId;
    case "ownOrTeam":
      return actor.settings.membersSeeTeamTime || ownerOf(resource) === actor.userId;
    case "scope":
      return resource.kind === "entry" && inScope(actor, resource);
    case "managedPeople": {
      const owner = ownerOf(resource);
      return owner !== null && (owner === actor.userId || actor.managedUserIds.has(owner));
    }
    case "managedProjects":
      return projectId !== null && actor.managedProjectIds.has(projectId);
    case "visible":
      return (
        resource.kind === "project" &&
        (resource.visibility !== "PRIVATE" ||
          resource.isMember === true ||
          (projectId !== null && actor.managedProjectIds.has(projectId)))
      );
    case "creator": {
      const type = CREATED[action];
      return type !== undefined && allowsRole(actor.settings.creators[type], actor.role);
    }
    case "taskGroups": {
      // Decision 11: with tasks by group, a task is tracked through one of its
      // groups, or by a manager on a project they manage.
      if (actor.settings.taskVisibility === "EVERYONE") return true;
      if (resource.kind !== "task") return false;
      if (actor.managedProjectIds.has(resource.projectId)) return true;
      return (resource.groupIds ?? []).some((g) => actor.groupIds.has(g));
    }
    case "unlessHidden":
      return resource.kind === "page" && !actor.settings.hiddenPages.includes(resource.page);
    case "teamSetting":
      return actor.settings.membersSeeTeamTime;
    case "unlessForced":
      // Decision 7: force timer binds a person's own time; time added for
      // someone else (an admin or manager for a managed person) is exempt.
      return !actor.settings.forceTimer || ownerOf(resource) !== actor.userId;
  }
}

/** Why the actor may not act: 403 (role or settings), 404 (outside their scope), or null. */
export function denial(actor: Actor, action: Action, resource: Resource): 403 | 404 | null {
  if (MEMBER_GUARDED.has(action) && resource.kind === "member") {
    if (resource.role === "owner") return 403;
    if (resource.userId === actor.userId) return 403;
  }
  const rule = PERMISSION_MATRIX[action][actor.role];
  if (check(actor, action, rule, resource)) return null;
  return SCOPED.has(rule) ? 404 : 403;
}

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  return denial(actor, action, resource) === null;
}

const RULE_WORDS: Record<Rule, string> = {
  yes: "yes",
  no: "—",
  own: "their own",
  ownOrTeam: "their own (everyone's if the workspace allows)",
  scope: "their scope",
  managedPeople: "themselves and people they manage",
  managedProjects: "projects they manage",
  visible: "public, private ones they are on, or manage",
  creator: "if the workspace allows",
  unlessHidden: "unless the workspace hides it",
  teamSetting: "if the workspace allows",
  unlessForced: "unless force timer is on (own time)",
  taskGroups: "every task, or when tasks are by group: their groups' tasks and projects they manage",
};

const SECTION_TITLES: Record<string, string> = {
  workspace: "Workspace",
  member: "Members",
  group: "Groups",
  page: "Pages",
  client: "Clients",
  project: "Projects",
  task: "Tasks",
  tag: "Tags",
  rate: "Rates",
  entry: "Time entries",
  report: "Reports",
  shareLink: "Share links",
  import: "Import",
};

/** The matrix as markdown, for docs/PERMISSIONS.md. */
export function renderPermissionsMarkdown(): string {
  const lines = [
    "# Permissions",
    "",
    "<!-- Generated from packages/core/src/permissions.ts by `pnpm permissions:doc`. Do not edit. -->",
    "",
    "Owners and admins see and manage everything (only the owner transfers ownership).",
    "A manager's **scope** is the people they manage, directly or through groups, and the projects",
    "they manage; a manager with no assignments reads only their own time. Nobody may change the",
    "role of, deactivate or remove the owner, or deactivate or remove themselves.",
    "A refusal that depends on the role or a workspace setting is a 403; one that depends on the",
    "resource (outside the scope, a private project) is a 404, so its existence is not revealed.",
  ];
  const sections = new Map<string, Action[]>();
  for (const action of ACTIONS) {
    const prefix = action.split(".")[0]!;
    sections.set(prefix, [...(sections.get(prefix) ?? []), action]);
  }
  for (const [prefix, actions] of sections) {
    lines.push("", `## ${SECTION_TITLES[prefix] ?? prefix}`, "");
    lines.push(`| Action | ${ROLES.map((r) => ROLE_LABELS[r]).join(" | ")} |`);
    lines.push(`| --- | ${ROLES.map(() => "---").join(" | ")} |`);
    for (const action of actions) {
      const cells = ROLES.map((role) => RULE_WORDS[PERMISSION_MATRIX[action][role]]);
      lines.push(`| \`${action}\` | ${cells.join(" | ")} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}
