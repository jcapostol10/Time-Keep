"use client";

import { type ReportKind } from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { workspaceRoutes } from "@/lib/routes";

import { useTracker } from "../tracker/tracker-provider";
import { ExportMenu } from "./export-menu";
import { FilterBar } from "./filter-bar";
import { reportHref, useReportQuery } from "./report-url";
import { ShareDialog } from "./share-dialog";

const VIEWS: { kind: ReportKind; label: string }[] = [
  { kind: "summary", label: "Summary" },
  { kind: "detailed", label: "Detailed" },
  { kind: "weekly", label: "Weekly" },
];

/** The frame every report shares: the view tabs (keeping the query), the filter bar, actions. */
export function ReportShell({
  kind,
  actions,
  children,
}: {
  kind: ReportKind;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { slug } = useTracker();
  const { params } = useReportQuery();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        actions={
          <>
            {actions}
            <ShareDialog kind={kind} />
            <ExportMenu kind={kind} />
          </>
        }
      />
      <nav aria-label="Report views" className="flex gap-1 border-b">
        {VIEWS.map((v) => (
          <Link
            key={v.kind}
            href={reportHref(slug, v.kind, params)}
            aria-current={v.kind === kind ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              v.kind === kind
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {v.label}
          </Link>
        ))}
        <Link
          href={`${workspaceRoutes.reports(slug)}/exports`}
          className="text-muted-foreground hover:text-foreground -mb-px ml-auto border-b-2 border-transparent px-3 py-2 text-sm font-medium"
        >
          Exports
        </Link>
        <Link
          href={`${workspaceRoutes.reports(slug)}/shared`}
          className="text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium"
        >
          Shared
        </Link>
      </nav>
      <FilterBar />
      {children}
    </div>
  );
}
