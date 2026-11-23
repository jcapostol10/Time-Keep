"use client";

import { Button } from "@timekeep/ui/components/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@timekeep/ui/components/sheet";
import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/logo";
import { useHydrated } from "@/hooks/use-hydrated";
import { ThemeToggle } from "@/components/theme-toggle";
import { workspaceRoutes } from "@/lib/routes";

import { HelpMenu } from "./help-menu";
import { SidebarNav } from "./sidebar-nav";
import { TimerChip } from "./timer-chip";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";

export interface AppShellProps {
  /** Nav item labels the viewer may not open. */
  hiddenNav: string[];
  user: { name: string; email: string; image: string | null };
  workspace: WorkspaceOption;
  workspaces: WorkspaceOption[];
  children: React.ReactNode;
}

export function AppShell({ user, workspace, workspaces, hiddenNav, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hydrated = useHydrated();
  const home = workspaceRoutes.tracker(workspace.slug);

  return (
    <div className="flex min-h-svh">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-5">
          <Link href={home} aria-label="TimeKeep home">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav slug={workspace.slug} hidden={hiddenNav} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:px-8">
          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <MenuIcon className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar text-sidebar-foreground w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex h-14 items-center border-b px-5">
                <Logo />
              </div>
              <SidebarNav
                slug={workspace.slug}
                hidden={hiddenNav}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />

          {/* Never shrinks: the workspace name gives way first, so the chip pushes nothing off a phone. */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <TimerChip slug={workspace.slug} />
            <HelpMenu />
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        {/*
          Content starts at the sidebar's edge, with one gutter (32px; 16px on a
          phone), and stops at 1200px: lines stay readable and the eye has one
          left edge to return to. A page of wide tables (reports, timesheet,
          team) marks its root `data-layout="wide"` and takes the full width.
        */}
        <main className="flex-1 px-4 py-6 md:px-8" data-hydrated={hydrated}>
          <div className="w-full max-w-[1200px] has-[[data-layout=wide]]:max-w-none">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
