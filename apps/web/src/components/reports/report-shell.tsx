"use client";

import { AUDIT_DEFAULT_PARAMS, type ReportView } from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { workspaceRoutes } from "@/lib/routes";

import { useTracker } from "../tracker/tracker-provider";
import { AuditFilter } from "./audit-filter";
import { ExportMenu } from "./export-menu";
import { FilterBar } from "./filter-bar";
import { reportHref, useReportQuery } from "./report-url";
import { RoundingToggle } from "./rounding-toggle";
import { ShareDialog } from "./share-dialog";

const VIEWS: { kind: ReportView; label: string }[] = [
  { kind: "summary", label: "Summary" },
  { kind: "detailed", label: "Detailed" },
  { kind: "weekly", label: "Weekly" },
  { kind: "audit", label: "Audit" },
];

/** The query another view opens with: the Audit tab adds its default criteria; the others drop them. */
function paramsFor(view: ReportView, params: string): string {
  const next = new URLSearchParams(params);
  if (view === "audit") {
    if (!next.has("audit")) {
      for (const [k, v] of new URLSearchParams(AUDIT_DEFAULT_PARAMS)) next.append(k, v);
    }
  } else {
    for (const key of ["audit", "shortMinutes", "longHours"]) next.delete(key);
  }
  return next.toString();
}

/** The frame every report shares: the view tabs (keeping the query), the filter bar, actions. */
export function ReportShell({
  view,
  actions,
  children,
}: {
  view: ReportView;
  actions?: ReactNode;
  children: ReactNode;
}) {
  // The Audit tab is the Detailed report with criteria: it exports and shares as Detailed.
  const kind = view === "audit" ? "detailed" : view;
  const { slug } = useTracker();
  const { params } = useReportQuery();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        actions={
          <>
            {actions}
            <RoundingToggle />
            <ShareDialog kind={kind} />
            <ExportMenu kind={kind} />
          </>
        }
      />
      <nav
        aria-label="Report views"
        className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none]"
      >
        {VIEWS.map((v) => (
          <Link
            key={v.kind}
            href={reportHref(slug, v.kind, paramsFor(v.kind, params))}
            aria-current={v.kind === view ? "page" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              v.kind === view
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {v.label}
          </Link>
        ))}
        <Link
          href={`${workspaceRoutes.reports(slug)}/exports`}
          className="text-muted-foreground hover:text-foreground ml-auto shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium"
        >
          Exports
        </Link>
        <Link
          href={`${workspaceRoutes.reports(slug)}/shared`}
          className="text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium"
        >
          Shared
        </Link>
      </nav>
      <FilterBar extra={view === "audit" ? <AuditFilter /> : null} />
      {children}
    </div>
  );
}
