"use client";

import { cn } from "@timekeep/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { workspaceRoutes } from "@/lib/routes";

/** The schedule's tabs: Team and Projects for planners, My schedule for everyone. */
export function ScheduleTabs({ slug, planner }: { slug: string; planner: boolean }) {
  const pathname = usePathname();
  const tabs = [
    ...(planner
      ? [
          { label: "Team", href: workspaceRoutes.schedule(slug, "team") },
          { label: "Projects", href: workspaceRoutes.schedule(slug, "projects") },
        ]
      : []),
    { label: "My schedule", href: workspaceRoutes.schedule(slug, "mine") },
  ];
  return (
    <nav aria-label="Schedule" className="mb-4 flex gap-1 border-b">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
