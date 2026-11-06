"use client";

import {
  formatDuration,
  formatMoney,
  hasProfit,
  marginPercent,
  PROFIT_GROUP_KEYS,
  type ProfitGroupKey,
  profitGroupKey,
  type ReportTotals,
} from "@timekeep/core";
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
import { GROUP_LABELS } from "./group-by-control";
import { amountText, CostNotes, MoneyCell } from "./money-cell";
import { useReportQuery } from "./report-url";
import { useProfit } from "./use-report";

/**
 * The Profit tab (Phase 6a): time, amount, cost, profit and margin per
 * project, client or person, the most profitable first. Cost and profit are
 * in the workspace currency; amounts billed in another currency are listed
 * beside it and left out of profit, since nothing is converted.
 */
export function ProfitView() {
  const { slug, viewer } = useTracker();
  const { query, params, set } = useReportQuery();
  const { data } = useProfit(slug, params);
  const by = profitGroupKey(query);
  const fmt = (seconds: number) => formatDuration(seconds, viewer.durationFormat);
  const currency = data?.money?.currency ?? "USD";
  const money = (minor: number) => formatMoney(minor, currency);
  const profit = (t: ReportTotals) => (hasProfit(t) ? money(t.profitMinor) : "—");
  const margin = (t: ReportTotals) => {
    const percent = hasProfit(t) ? marginPercent(t) : null;
    return percent === null ? "—" : `${percent}%`;
  };
  // Each group's bar is its profit against the largest, loss or gain.
  const largest = Math.max(1, ...(data?.groups ?? []).map((g) => Math.abs(g.totals.profitMinor)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">{data?.range.label ?? "…"}</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="report-total">
            {data ? profit(data.totals) : "…"}
          </p>
          {data ? (
            <p className="text-muted-foreground text-sm">
              profit · {amountText(data.totals, currency)} billed · {money(data.totals.costMinor)}{" "}
              cost · {fmt(data.totals.durationSeconds)}
            </p>
          ) : null}
        </div>
        <Select value={by} onValueChange={(key) => set({ groupBy: [key as ProfitGroupKey] })}>
          <SelectTrigger className="w-40" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROFIT_GROUP_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {GROUP_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No time in this range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label="Profit">
            <TableHeader>
              <TableRow>
                <TableHead>{GROUP_LABELS[by]}</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Billable</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.groups.map((g) => (
                <TableRow key={g.id ?? "none"}>
                  <TableCell className="min-w-40 font-medium">
                    {g.label}
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1 block h-1.5 rounded-full",
                        g.totals.profitMinor < 0 ? "bg-destructive" : "bg-primary",
                      )}
                      style={{
                        width: `${hasProfit(g.totals) ? Math.round((Math.abs(g.totals.profitMinor) / largest) * 100) : 0}%`,
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(g.totals.durationSeconds)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {fmt(g.totals.billableSeconds)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <MoneyCell amounts={g.totals} currency={currency} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(g.totals.costMinor)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-semibold tabular-nums",
                      g.totals.profitMinor < 0 && "text-destructive",
                    )}
                  >
                    {profit(g.totals)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{margin(g.totals)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt(data.totals.durationSeconds)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {fmt(data.totals.billableSeconds)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <MoneyCell amounts={data.totals} currency={currency} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(data.totals.costMinor)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {profit(data.totals)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{margin(data.totals)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <CostNotes totals={data.totals} />
        </div>
      )}
    </div>
  );
}
