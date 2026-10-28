import {
  BarChart3Icon,
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
export function hiddenNavLabels(actor: Actor): string[] {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter(
      (item) => item.permission && !can(actor, item.permission.action, item.permission.resource),
    )
    .map((item) => item.label);
}
