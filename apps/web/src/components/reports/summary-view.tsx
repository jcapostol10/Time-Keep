"use client";

import { formatDuration } from "@timekeep/core";
import { Skeleton } from "@timekeep/ui/components/skeleton";

import { detailedHref, detailedParams } from "@/lib/report-links";

import { useTracker } from "../tracker/tracker-provider";
import { GroupByControl } from "./group-by-control";
import { useReportQuery } from "./report-url";
import { SummaryCharts } from "./summary-charts";
import { SummaryTable } from "./summary-table";
import { useSummary } from "./use-report";

export function SummaryView() {
  const { slug, viewer } = useTracker();
  const { query, params, set } = useReportQuery();
  const { data } = useSummary(slug, params);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">{data?.range.label ?? "…"}</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="report-total">
            {data ? formatDuration(data.totals.durationSeconds, viewer.durationFormat) : "…"}
          </p>
          {data ? (
            <p className="text-muted-foreground text-sm">
              {formatDuration(data.totals.billableSeconds, viewer.durationFormat)} billable ·{" "}
              {data.totals.entryCount} {data.totals.entryCount === 1 ? "entry" : "entries"}
            </p>
          ) : null}
        </div>
        <GroupByControl value={query.groupBy} onChange={(groupBy) => set({ groupBy })} />
      </div>
      {data ? (
        <>
          <SummaryCharts report={data} durationFormat={viewer.durationFormat} />
          <SummaryTable
            report={data}
            durationFormat={viewer.durationFormat}
            linkFor={(steps) =>
              detailedHref(slug, detailedParams(query, steps, data.range, viewer.timezone))
            }
          />
        </>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </div>
  );
}
