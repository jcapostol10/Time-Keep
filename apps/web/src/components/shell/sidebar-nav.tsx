"use client";

import { cn } from "@timekeep/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS } from "./nav-items";

export function SidebarNav({
  slug,
  hidden,
  onNavigate,
}: {
  slug: string;
  /** Item labels the viewer may not open (hiddenNavLabels on the server). */
  hidden: string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-muted-foreground mb-1 px-3 text-xs font-medium">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items
              .filter((item) => !hidden.includes(item.label))
              .map((item) => {
                const href = item.href(slug);
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        // Quiet until it is the page: then ink text and a 2px bar on the
                        // left edge, never a filled pill.
                        "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        "text-muted-foreground hover:text-foreground",
                        active &&
                          "text-foreground before:bg-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
