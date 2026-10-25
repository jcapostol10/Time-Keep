import {
  formatDateInZone,
  formatDuration,
  formatRangeLabel,
  formatTimeOfDay,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";

import type { DetailedEntryDTO, SummaryReport, WeeklyReport } from "@/lib/report-types";
import type { ResolvedShareLink } from "@/server/share-links";

import { SummaryCharts } from "./summary-charts";
import { SummaryTable } from "./summary-table";

export type SharedReportData =
  | { kind: "summary"; report: SummaryReport }
  | { kind: "detailed"; entries: DetailedEntryDTO[]; totalSeconds: number; more: boolean }
  | { kind: "weekly"; report: WeeklyReport };

/** A shared report, read-only, for someone without an account. */
export function SharedReport({
  link,
  data,
  range,
}: {
  link: Pick<ResolvedShareLink, "title" | "workspaceName" | "prefs">;
  data: SharedReportData;
  range: { from: Date; to: Date };
}) {
  const prefs = link.prefs;
  const fmt = (s: number) => formatDuration(s, prefs.durationFormat);
  const total =
    data.kind === "summary"
      ? data.report.totals.durationSeconds
      : data.kind === "weekly"
        ? data.report.total
        : data.totalSeconds;

  return (
    <div className="space-y-6">
      <header className="space-y-1 border-b pb-4">
        <p className="text-primary text-xs font-semibold uppercase tracking-wide">
          {link.workspaceName}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{link.title}</h1>
        <p className="text-muted-foreground text-sm">
          {formatRangeLabel(range.from, range.to, prefs.timezone)}
        </p>
      </header>
      <p className="text-3xl font-semibold tabular-nums" data-testid="report-total">
        {fmt(total)}
      </p>
      {data.kind === "summary" ? (
        <>
          <SummaryCharts report={data.report} durationFormat={prefs.durationFormat} />
          <SummaryTable report={data.report} durationFormat={prefs.durationFormat} />
        </>
      ) : data.kind === "weekly" ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{data.report.by === "user" ? "Person" : "Project"}</TableHead>
                {data.report.dayKeys.map((d) => (
                  <TableHead key={d} className="text-right">
                    {formatDateInZone(
                      zonedDateTimeToInstant({ date: d, hours: 12, minutes: 0 }, prefs.timezone),
                      prefs.timezone,
                      prefs.dateFormat,
                    )}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.report.rows.map((r) => (
                <TableRow key={r.id ?? "none"}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  {r.days.map((s, i) => (
                    <TableCell key={data.report.dayKeys[i]} className="text-right tabular-nums">
                      {s ? fmt(s) : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmt(r.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                {data.report.dayTotals.map((s, i) => (
                  <TableCell key={data.report.dayKeys[i]} className="text-right tabular-nums">
                    {fmt(s)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmt(data.report.total)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.description || "(no description)"}</TableCell>
                    <TableCell>{e.projectName ?? "No project"}</TableCell>
                    <TableCell>{e.userName}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateInZone(new Date(e.start), prefs.timezone, prefs.dateFormat)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatTimeOfDay(new Date(e.start), prefs.timezone, prefs.timeFormat)} –{" "}
                      {formatTimeOfDay(new Date(e.end), prefs.timezone, prefs.timeFormat)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmt(e.durationSeconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.more ? (
            <p className="text-muted-foreground text-sm">
              Showing the latest {data.entries.length} entries; download the CSV for all of them.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
