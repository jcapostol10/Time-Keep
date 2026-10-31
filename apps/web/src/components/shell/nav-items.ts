import {
  BarChart3Icon,
  CheckCheckIcon,
  Building2Icon,
  CalendarDaysIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  SettingsIcon,
  TableIcon,
  TagIcon,
  TimerIcon,
  UsersIcon,
} from "lucide-react";

import { type Action, type Actor, can, type Resource } from "@timekeep/core";

import { workspaceRoutes } from "@/lib/routes";

export interface NavItem {
  label: string;
  href: (slug: string) => string;
  icon: LucideIcon;
  /** Hidden unless the permission matrix allows this (the page itself also checks). */
  permission?: { action: Action; resource: Resource };
  /** Hidden unless this holds (a rule the matrix cannot say alone). */
  visible?: (actor: Actor, flags: NavFlags) => boolean;
}

/** Workspace switches that show or hide items. */
export interface NavFlags {
  approvalEnabled: boolean;
}

/** Whoever may review someone's period: owners, admins, and managers unless only admins approve. */
export function mayReviewAny(actor: Actor): boolean {
  if (actor.role === "owner" || actor.role === "admin") return true;
  return actor.role === "manager" && actor.settings.approvalReviewers !== "ADMINS";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Track",
    items: [
      { label: "Time Tracker", href: workspaceRoutes.tracker, icon: TimerIcon },
      { label: "Timesheet", href: workspaceRoutes.timesheet, icon: TableIcon },
      { label: "Calendar", href: workspaceRoutes.calendar, icon: CalendarDaysIcon },
    ],
  },
  {
    label: "Analyze",
    items: [
      { label: "Dashboard", href: workspaceRoutes.dashboard, icon: LayoutDashboardIcon },
      {
        label: "Approvals",
        href: (slug) => workspaceRoutes.approvals(slug),
        icon: CheckCheckIcon,
        // Everyone, for their own requests; reviewers also see the team's.
        visible: (_actor, flags) => flags.approvalEnabled,
      },
      {
        label: "Reports",
        href: workspaceRoutes.reports,
        icon: BarChart3Icon,
        permission: { action: "page.view", resource: { kind: "page", page: "reports" } },
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        label: "Projects",
        href: workspaceRoutes.projects,
        icon: FolderKanbanIcon,
        permission: { action: "page.view", resource: { kind: "page", page: "projects" } },
      },
      {
        label: "Team",
        href: workspaceRoutes.team,
        icon: UsersIcon,
        permission: { action: "page.view", resource: { kind: "page", page: "team" } },
      },
      {
        label: "Clients",
        href: workspaceRoutes.clients,
        icon: Building2Icon,
        // Whoever may create clients opens the page; editing stays with admins.
        permission: { action: "client.create", resource: { kind: "none" } },
      },
      {
        label: "Tags",
        href: workspaceRoutes.tags,
        icon: TagIcon,
        permission: { action: "tag.create", resource: { kind: "none" } },
      },
      { label: "Settings", href: workspaceRoutes.settings, icon: SettingsIcon },
    ],
  },
];

/** Labels of the items this actor may not open; computed on the server. */
export function hiddenNavLabels(
  actor: Actor,
  flags: NavFlags = { approvalEnabled: false },
): string[] {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter(
      (item) =>
        (item.permission && !can(actor, item.permission.action, item.permission.resource)) ||
        (item.visible && !item.visible(actor, flags)),
    )
    .map((item) => item.label);
}
