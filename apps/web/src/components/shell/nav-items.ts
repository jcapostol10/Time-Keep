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

import { workspaceRoutes } from "@/lib/routes";

export interface NavItem {
  label: string;
  href: (slug: string) => string;
  icon: LucideIcon;
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
      { label: "Reports", href: workspaceRoutes.reports, icon: BarChart3Icon },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "Projects", href: workspaceRoutes.projects, icon: FolderKanbanIcon },
      { label: "Team", href: workspaceRoutes.team, icon: UsersIcon },
      { label: "Clients", href: workspaceRoutes.clients, icon: Building2Icon },
      { label: "Tags", href: workspaceRoutes.tags, icon: TagIcon },
      { label: "Settings", href: workspaceRoutes.settings, icon: SettingsIcon },
    ],
  },
];
