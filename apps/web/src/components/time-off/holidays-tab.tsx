"use client";

import { formatDateKey } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import { Switch } from "@timekeep/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { fetchJson } from "@/lib/fetch-json";
import type { HolidayDTO } from "@/lib/time-off-types";
import { deleteHolidayAction, saveHolidayAction } from "@/server/actions/time-off";

import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";
import { type Assignees, AssigneesField, assigneesLabel, type Option } from "./assignees-field";
import { ImportHolidaysDialog } from "./import-holidays-dialog";

export const ESTIMATED_LABEL = "Estimated: confirm the proclaimed date";

/** Owners and admins: a year of holidays, added by hand or imported for any country. */
export function HolidaysTab({
  slug,
  year: initialYear,
  people,
  groups,
}: {
  slug: string;
  year: number;
  people: Option[];
  groups: Option[];
}) {
  const qc = useQueryClient();
  const [year, setYear] = useState(initialYear);
  const { data, isPending } = useQuery({
    queryKey: timeOffKeys.holidays(slug, year),
    queryFn: () =>
      fetchJson<{ holidays: HolidayDTO[] }>(timeOffUrls.holidays(slug, year)).then(
        (r) => r.holidays,
      ),
  });
  const [editing, setEditing] = useState<HolidayDTO | "new" | null>(null);
  const [importing, setImporting] = useState(false);

  async function remove(h: HolidayDTO) {
    const result = await deleteHolidayAction(slug, h.id);
    if (!result.ok) toast.error(result.error);
    else toast.success(`${h.name} deleted`);
    await qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <h2 className="w-14 text-center font-semibold tabular-nums">{year}</h2>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>
            Import public holidays
          </Button>
          <Button onClick={() => setEditing("new")}>Add holiday</Button>
        </div>
      </div>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="rounded-md border">
          <Table aria-label={`Holidays in ${year}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                    No holidays in {year}. Import your country&apos;s public holidays or add one.
                  </TableCell>
                </TableRow>
              ) : (
                (data ?? []).map((h) => (
                  <TableRow key={`${h.id}-${h.occursOn}`}>
                    <TableCell className="whitespace-nowrap">{formatDateKey(h.occursOn)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{h.name}</span>
                      <span className="ml-2 inline-flex flex-wrap gap-1">
                        {h.repeatsYearly ? <Badge variant="outline">Every year</Badge> : null}
                        {h.estimated ? <Badge variant="secondary">{ESTIMATED_LABEL}</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {assigneesLabel(
                        { everyone: false, userIds: h.userIds, groupIds: h.groupIds },
                        people,
                        groups,
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {h.source ?? "Added by hand"}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(h)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(h)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <HolidayDialog
          slug={slug}
          holiday={editing === "new" ? null : editing}
          people={people}
          groups={groups}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? (
        <ImportHolidaysDialog slug={slug} year={year} onClose={() => setImporting(false)} />
      ) : null}
    </div>
  );
}

function HolidayDialog({
  slug,
  holiday,
  people,
  groups,
  onClose,
}: {
  slug: string;
  holiday: HolidayDTO | null;
  people: Option[];
  groups: Option[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(holiday?.name ?? "");
  const [date, setDate] = useState(holiday?.date ?? "");
  const [repeatsYearly, setRepeatsYearly] = useState(holiday?.repeatsYearly ?? false);
  const [assignees, setAssignees] = useState<Assignees>({
    everyone: !holiday || (holiday.userIds.length === 0 && holiday.groupIds.length === 0),
    userIds: holiday?.userIds ?? [],
    groupIds: holiday?.groupIds ?? [],
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const result = await saveHolidayAction(
        slug,
        {
          name,
          date,
          repeatsYearly,
          userIds: assignees.everyone ? [] : assignees.userIds,
          groupIds: assignees.everyone ? [] : assignees.groupIds,
        },
        holiday?.id,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(holiday ? "Holiday saved" : "Holiday added");
      await qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{holiday ? "Edit holiday" : "New holiday"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="holiday-name">Name</Label>
            <Input
              id="holiday-name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="holiday-date">Date</Label>
            <Input
              id="holiday-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Repeats every year</span>
            <Switch
              aria-label="Repeats every year"
              checked={repeatsYearly}
              onCheckedChange={setRepeatsYearly}
            />
          </label>
          <AssigneesField
            value={assignees}
            onChange={setAssignees}
            people={people}
            groups={groups}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !date}>
              Save holiday
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
