"use client";

import {
  type DrillStep,
  type DurationFormat,
  formatDuration,
  type ReportGroup,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import type { SummaryReport } from "@/lib/report-types";

import { GROUP_LABELS } from "./group-by-control";

function groupPath(parents: string[], group: ReportGroup): string {
  return [...parents, `${group.key}:${group.id ?? ""}`].join("/");
}

/**
 * The grouped totals, one level per key, each group collapsible. With `linkFor`, each
 * group's name links to the Detailed report behind it (not on the public share page).
 */
export function SummaryTable({
  report,
  durationFormat,
  linkFor,
}: {
  report: SummaryReport;
  durationFormat: DurationFormat;
  linkFor?: (steps: DrillStep[]) => string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const fmt = (seconds: number) => formatDuration(seconds, durationFormat);

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function rows(
    groups: ReportGroup[],
    level: number,
    parents: string[],
    steps: DrillStep[],
  ): React.ReactNode {
    return groups.map((g) => {
      const path = groupPath(parents, g);
      const here = [...steps, { key: g.key, id: g.id }];
      const open = !collapsed.has(path);
      const hasChildren = g.children.length > 0;
      return (
        <Fragment key={path}>
          <TableRow data-level={level}>
            <TableCell className="w-8 p-1">
              {hasChildren ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={open ? "Collapse" : "Expand"}
                  aria-expanded={open}
                  onClick={() => toggle(path)}
                >
                  {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </Button>
              ) : null}
            </TableCell>
            <TableCell style={{ paddingLeft: `${level * 20 + 8}px` }} className="font-medium">
              {linkFor ? (
                <Link href={linkFor(here)} className="hover:underline">
                  {g.label}
                </Link>
              ) : (
                g.label
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmt(g.totals.durationSeconds)}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {fmt(g.totals.billableSeconds)}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {g.totals.entryCount}
            </TableCell>
          </TableRow>
          {hasChildren && open ? rows(g.children, level + 1, [...parents, path], here) : null}
        </Fragment>
      );
    });
  }

  if (report.groups.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No time in this range.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{report.groupBy.map((k) => GROUP_LABELS[k]).join(" › ")}</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Billable</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Entries</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{rows(report.groups, 0, [], [])}</TableBody>
        <TableFooter>
          <TableRow>
            <TableCell />
            <TableCell>Total</TableCell>
            <TableCell className="text-right tabular-nums">
              {fmt(report.totals.durationSeconds)}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {fmt(report.totals.billableSeconds)}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {report.totals.entryCount}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {report.groupBy.includes("tag") ? (
        <p className="text-muted-foreground border-t px-3 py-2 text-xs">
          An entry with several tags counts under each of them, so tag totals can exceed the total.
        </p>
      ) : null}
    </div>
  );
}
