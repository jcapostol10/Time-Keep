"use client";

import { cn } from "@timekeep/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS } from "./nav-items";

export function SidebarNav({ slug, onNavigate }: { slug: string; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-muted-foreground mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const href = item.href(slug);
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "focus-visible:ring-sidebar-ring focus-visible:outline-none focus-visible:ring-2",
                      active && "bg-sidebar-accent text-sidebar-accent-foreground",
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
