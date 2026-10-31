"use client";

import { formatDuration, formatMoney } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@timekeep/ui/components/table";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Columns3Icon,
  Loader2Icon,
  Trash2Icon,
  PencilIcon,
} from "lucide-react";
import { useState } from "react";

import type { DetailedPaging, DetailedSort } from "@/lib/report-types";

import { useIsSaving } from "../tracker/saving-store";
import { useTracker } from "../tracker/tracker-provider";
import { BulkEditDialog } from "../tracker/bulk-edit-dialog";
import { useEntryMutations } from "../tracker/use-entry-mutations";
import { useEntryWrites } from "../tracker/use-entry-writes";
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
  const money = first?.money ?? null;
  const show = (key: DetailedColumn) => !hidden.has(key) && (key !== "amount" || money !== null);
  const writes = useEntryWrites();
  const { bulkUpdate } = useEntryMutations();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  // Only editable entries can be selected; an entry gone after a refetch drops out by itself.
  const ownIds = entries.filter((e) => e.editable).map((e) => e.id);
  const selected = ownIds.filter((id) => picked.has(id));
  const allSelected = ownIds.length > 0 && selected.length === ownIds.length;

  function pick(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function deleteSelected() {
    const ids = selected;
    if (await writes.remove(ids)) setPicked(new Set());
  }

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
              {money ? ` · ${formatMoney(first.totals.amountMinor, money.currency)}` : ""}
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
            {DETAILED_COLUMNS.filter((c) => c.key !== "amount" || money).map((c) => (
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
          {selected.length > 0 ? (
            <div
              role="toolbar"
              aria-label="Selected entries"
              className="bg-muted/50 flex items-center gap-2 border-b px-3 py-2 text-sm"
            >
              <span className="font-medium">{selected.length} selected</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                <PencilIcon /> Edit
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void deleteSelected()}
              >
                <Trash2Icon /> Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pr-0">
                  {ownIds.length > 0 ? (
                    <Checkbox
                      aria-label="Select all editable entries"
                      checked={allSelected ? true : selected.length > 0 ? "indeterminate" : false}
                      onCheckedChange={(checked) =>
                        setPicked(checked === true ? new Set(ownIds) : new Set())
                      }
                    />
                  ) : null}
                </TableHead>
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
                {show("amount") ? <TableHead className="text-right">Amount</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <DetailedRow
                  key={e.id}
                  entry={e}
                  hidden={hidden}
                  currency={money?.currency ?? null}
                  selected={picked.has(e.id)}
                  onSelectedChange={(on) => pick(e.id, on)}
                />
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
      <BulkEditDialog
        count={selected.length}
        open={editing}
        onOpenChange={setEditing}
        onApply={async (patch) => {
          const ok = await bulkUpdate(selected, patch);
          if (ok) setPicked(new Set());
          return ok;
        }}
      />
    </div>
  );
}
