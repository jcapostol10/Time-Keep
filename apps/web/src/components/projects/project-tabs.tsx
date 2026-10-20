"use client";

import { cn } from "@timekeep/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { workspaceRoutes } from "@/lib/routes";

const TABS = [
  { label: "Tasks", tab: undefined },
  { label: "Access", tab: "access" },
  { label: "Status", tab: "status" },
  { label: "Settings", tab: "settings" },
  { label: "Budget", tab: "budget" },
  { label: "Rates", tab: "rates" },
] as const;

/** Route-backed tabs: each tab is a page under the project, so it has its own URL. */
export function ProjectTabs({ slug, projectId }: { slug: string; projectId: string }) {
  const pathname = usePathname();
  return (
    <nav
      role="tablist"
      aria-label="Project sections"
      className="flex gap-1 overflow-x-auto border-b"
    >
      {TABS.map(({ label, tab }) => {
        const href = workspaceRoutes.project(slug, projectId, tab);
        const active = pathname === href;
        return (
          <Link
            key={label}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            href={href}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
