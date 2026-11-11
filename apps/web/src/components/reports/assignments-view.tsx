"use client";

import { type AssignmentGroupKey, type AssignmentsRow, formatDuration } from "@timekeep/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { cn } from "@timekeep/ui/lib/utils";

import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";
import { useAssignmentsReport } from "./use-report";

const LABELS: Record<AssignmentGroupKey, string> = {
  user: "Person",
  project: "Project",
  day: "Day",
  week: "Week",
};

/**
 * The Assignments tab (Phase 7b, decision 22): the published plan against
 * tracked work, by person, project, day or week, with the variance
 * (tracked − scheduled) and its share of the plan.
 */
export function AssignmentsView() {
  const { slug, viewer } = useTracker();
  const { query, params, set } = useReportQuery();
  const { data } = useAssignmentsReport(slug, params);
  const span = (seconds: number) =>
    seconds < 0
      ? `−${formatDuration(-seconds, viewer.durationFormat)}`
      : formatDuration(seconds, viewer.durationFormat);
  const percent = (r: AssignmentsRow) =>
    r.variancePercent === null ? "—" : `${r.variancePercent.toFixed(1)}%`;
  const tone = (seconds: number) =>
    seconds < 0 ? "text-destructive" : seconds > 0 ? "text-emerald-600 dark:text-emerald-400" : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">{data?.label ?? "…"}</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="report-total">
            {data ? span(data.totals.trackedSeconds) : "…"}
          </p>
          {data ? (
            <p className="text-muted-foreground text-sm">
              tracked of {span(data.totals.scheduledSeconds)} scheduled
            </p>
          ) : null}
        </div>
        <Select
          value={query.assignmentsBy}
          onValueChange={(key) => set({ assignmentsBy: key as AssignmentGroupKey })}
        >
          <SelectTrigger className="w-40" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LABELS) as AssignmentGroupKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : data.rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
          Nothing scheduled or tracked in this range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label="Assignments report">
            <TableHeader>
              <TableRow>
                <TableHead>{LABELS[data.by]}</TableHead>
                <TableHead className="text-right">Scheduled</TableHead>
                <TableHead className="text-right">Tracked</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Variance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {span(r.scheduledSeconds)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {span(r.trackedSeconds)}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", tone(r.varianceSeconds))}>
                    {span(r.varianceSeconds)}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", tone(r.varianceSeconds))}>
                    {percent(r)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {span(data.totals.scheduledSeconds)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {span(data.totals.trackedSeconds)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    tone(data.totals.varianceSeconds),
                  )}
                >
                  {span(data.totals.varianceSeconds)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {percent(data.totals)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
