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
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";

export interface AppShellProps {
  user: { name: string; email: string; image: string | null };
  workspace: WorkspaceOption;
  workspaces: WorkspaceOption[];
  children: React.ReactNode;
}

export function AppShell({ user, workspace, workspaces, children }: AppShellProps) {
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
          <SidebarNav slug={workspace.slug} role={workspace.role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
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
                role={workspace.role}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />

          <div className="ml-auto flex items-center gap-1">
            <HelpMenu />
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8" data-hydrated={hydrated}>
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
