"use client";

import { formatDuration } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@timekeep/ui/components/table";
import { ArrowDownIcon, ArrowUpIcon, Columns3Icon, Loader2Icon } from "lucide-react";
import { useState } from "react";

import type { DetailedPaging, DetailedSort } from "@/lib/report-types";

import { useIsSaving } from "../tracker/saving-store";
import { useTracker } from "../tracker/tracker-provider";
import { DETAILED_COLUMNS, type DetailedColumn, useHiddenColumns } from "./detailed-columns";
import { DetailedRow } from "./detailed-row";
import { useReportQuery } from "./report-url";
import { useDetailed } from "./use-report";

function SortButton({
  label,
  sort,
  paging,
  onSort,
}: {
  label: string;
  sort: DetailedSort;
  paging: DetailedPaging;
  onSort: (sort: DetailedSort) => void;
}) {
  const active = paging.sort === sort;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 h-7 px-2"
      aria-label={`Sort by ${label.toLowerCase()}`}
      aria-pressed={active}
      onClick={() => onSort(sort)}
    >
      {label}
      {active ? (
        paging.dir === "desc" ? (
          <ArrowDownIcon className="size-3.5" />
        ) : (
          <ArrowUpIcon className="size-3.5" />
        )
      ) : null}
    </Button>
  );
}

/** Every entry of the range, newest first by default, 50 at a time. */
export function DetailedView({ initialPaging }: { initialPaging: DetailedPaging }) {
  const { slug, viewer } = useTracker();
  const { params } = useReportQuery();
  const saving = useIsSaving();
  const [paging, setPaging] = useState(initialPaging);
  const { hidden, toggle } = useHiddenColumns();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useDetailed(
    slug,
    params,
    paging,
  );
  const first = data?.pages[0];
  const entries = data?.pages.flatMap((p) => p.entries) ?? [];
  const show = (key: DetailedColumn) => !hidden.has(key);

  function onSort(sort: DetailedSort) {
    setPaging((p) => ({
      ...p,
      sort,
      dir: p.sort === sort ? (p.dir === "desc" ? "asc" : "desc") : "desc",
    }));
  }

  return (
    <div data-saving={saving} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">{first?.range.label ?? "…"}</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="report-total">
            {first?.totals
              ? formatDuration(first.totals.durationSeconds, viewer.durationFormat)
              : "…"}
          </p>
          {first?.totals ? (
            <p className="text-muted-foreground text-sm">
              {first.totals.entryCount} {first.totals.entryCount === 1 ? "entry" : "entries"}
            </p>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Columns3Icon /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {DETAILED_COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={!hidden.has(c.key)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggle(c.key)}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No time in this range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                {show("project") ? <TableHead>Project</TableHead> : null}
                {show("client") ? <TableHead>Client</TableHead> : null}
                {show("user") ? <TableHead>Person</TableHead> : null}
                {show("tags") ? <TableHead>Tags</TableHead> : null}
                {show("billable") ? <TableHead className="w-10">$</TableHead> : null}
                {show("date") ? (
                  <TableHead>
                    <SortButton label="Date" sort="start" paging={paging} onSort={onSort} />
                  </TableHead>
                ) : null}
                {show("time") ? <TableHead>Time</TableHead> : null}
                {show("duration") ? (
                  <TableHead className="text-right">
                    <SortButton label="Duration" sort="duration" paging={paging} onSort={onSort} />
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <DetailedRow key={e.id} entry={e} hidden={hidden} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? <Loader2Icon className="animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
