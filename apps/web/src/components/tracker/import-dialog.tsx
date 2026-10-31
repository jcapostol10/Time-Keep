"use client";

import {
  autoMapColumns,
  type ColumnMapping,
  DATE_FORMATS,
  type DateFormat,
  formatTimeOfDay,
  IMPORT_COLUMNS,
  type ImportColumn,
  MAX_IMPORT_BYTES,
  parseCsv,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { FileUpIcon, Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { TimezoneSelect } from "@/components/settings/timezone-select";
import { fetchJson } from "@/lib/fetch-json";
import type { ImportPlan } from "@/lib/import-types";

import { useTracker } from "./tracker-provider";
import { useTrackerCache, useTrackerOptions } from "./use-tracker-cache";

const FIELD_LABELS: Record<ImportColumn, string> = {
  date: "Date",
  start: "Start",
  end: "End",
  duration: "Duration",
  description: "Description",
  project: "Project",
  client: "Client",
  task: "Task",
  tags: "Tags",
  billable: "Billable",
  email: "Email",
};
const NONE = "__none__";

/** Posts the file and options; `dryRun` answers the plan, otherwise the count written. */
async function post<T>(slug: string, file: File, options: object, dryRun: boolean): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  form.set("options", JSON.stringify(options));
  const res = await fetch(`/api/w/${slug}/time-entries/import${dryRun ? "?dryRun=1" : ""}`, {
    method: "POST",
    body: form,
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "The import failed.");
  return body;
}

/**
 * Import time entries from a CSV: map the columns (matched by header),
 * choose the times' timezone and date format, check every row, then import
 * the ready ones. Everything is written through the entry service.
 */
export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { slug, viewer, notifyEntriesChanged, rules } = useTracker();
  const byGroup = rules.taskVisibility === "BY_GROUP";
  // Only someone who may add a task somewhere (owners, admins, a project's managers)
  // is asked which groups new tasks get.
  const { data: trackerOptions } = useTrackerOptions(slug);
  const mayCreateTasks = trackerOptions?.projects.some((p) => p.canCreateTask) ?? false;
  const cache = useTrackerCache(slug);
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [timezone, setTimezone] = useState(viewer.timezone);
  const [dateFormat, setDateFormat] = useState<DateFormat>(viewer.dateFormat);
  const [createMissing, setCreateMissing] = useState(true);
  // Decision 11: with tasks by group, a task the import creates needs its groups.
  const [newTaskGroupIds, setNewTaskGroupIds] = useState<string[]>([]);
  const groupsQuery = useQuery({
    queryKey: ["groups", slug],
    queryFn: () => fetchJson<{ groups: { id: string; name: string }[] }>(`/api/w/${slug}/groups`),
    enabled: open && byGroup && mayCreateTasks,
  });
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);

  function reset(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setFile(null);
      setHeaders([]);
      setMapping({});
      setPlan(null);
    }
  }

  async function onFile(chosen: File | undefined) {
    setPlan(null);
    if (!chosen) return;
    if (chosen.size > MAX_IMPORT_BYTES) {
      toast.error("The file is over 4 MB.");
      return;
    }
    const text = await chosen.text();
    const [header = []] = parseCsv(text);
    setFile(chosen);
    setHeaders(header);
    setMapping(autoMapColumns(header));
  }

  const options = { timezone, dateFormat, createMissing, mapping, newTaskGroupIds };

  async function check() {
    if (!file) return;
    setBusy(true);
    try {
      setPlan(await post<ImportPlan>(slug, file, options, true));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !plan) return;
    setBusy(true);
    try {
      const { imported } = await post<{ imported: number }>(
        slug,
        file,
        { ...options, fingerprint: plan.fingerprint },
        false,
      );
      await cache.invalidateEntries();
      void cache.invalidateOptions();
      notifyEntriesChanged();
      toast.success(imported === 1 ? "1 entry imported" : `${imported} entries imported`);
      reset(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  const creates = plan
    ? (
        [
          ["projects", plan.creates.projects.length],
          ["clients", plan.creates.clients.length],
          ["tasks", plan.creates.tasks.length],
          ["tags", plan.creates.tags.length],
        ] as const
      )
        .filter(([, n]) => n > 0)
        .map(([what, n]) => `${n} ${n === 1 ? what.slice(0, -1) : what}`)
    : [];
  const fmtTime = (iso: string | null) =>
    iso ? formatTimeOfDay(new Date(iso), timezone, viewer.timeFormat) : "";

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import time entries</DialogTitle>
          <DialogDescription>
            A CSV with a header row (up to 4 MB, 10,000 rows). Columns are matched by name; check
            the file before importing it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-file`}>CSV file</Label>
            <Input
              id={`${id}-file`}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
          {headers.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Timezone of the times</Label>
                  <TimezoneSelect
                    value={timezone}
                    onChange={(tz) => setTimezone(tz ?? viewer.timezone)}
                    ariaLabel="Timezone of the times"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date format</Label>
                  <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as DateFormat)}>
                    <SelectTrigger aria-label="Date format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FORMATS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f} (ISO dates always work)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-create`}
                  checked={createMissing}
                  onCheckedChange={(v) => setCreateMissing(v === true)}
                />
                <Label htmlFor={`${id}-create`} className="font-normal">
                  Create missing projects, clients, tasks and tags
                </Label>
              </div>
              {byGroup && createMissing && mayCreateTasks ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Groups for new tasks</legend>
                  {groupsQuery.data?.groups.length ? (
                    groupsQuery.data.groups.map((g) => (
                      <div key={g.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`${id}-group-${g.id}`}
                          aria-label={g.name}
                          checked={newTaskGroupIds.includes(g.id)}
                          onCheckedChange={(v) => {
                            setPlan(null);
                            setNewTaskGroupIds((ids) =>
                              v === true ? [...ids, g.id] : ids.filter((x) => x !== g.id),
                            );
                          }}
                        />
                        <Label htmlFor={`${id}-group-${g.id}`} className="font-normal">
                          {g.name}
                        </Label>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {groupsQuery.isPending
                        ? "Loading…"
                        : "No groups yet: tasks cannot be created."}
                    </p>
                  )}
                </fieldset>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {IMPORT_COLUMNS.map((column) => (
                  <div key={column} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{FIELD_LABELS[column]}</span>
                    <Select
                      value={mapping[column] === undefined ? NONE : String(mapping[column])}
                      onValueChange={(v) => {
                        setPlan(null);
                        setMapping((m) => {
                          const next = { ...m };
                          if (v === NONE) delete next[column];
                          else next[column] = Number(v);
                          return next;
                        });
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`Column for ${FIELD_LABELS[column]}`}
                        className="w-44"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not imported</SelectItem>
                        {headers.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {h || `Column ${i + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {plan ? (
            <section aria-label="Import check" className="space-y-2">
              <p className="text-sm font-medium" role="status">
                {plan.ok} {plan.ok === 1 ? "entry" : "entries"} ready, {plan.errors} with errors
                {creates.length > 0 ? ` · Will create: ${creates.join(", ")}` : ""}
              </p>
              <div className="max-h-64 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.rows.map((r) => (
                      <TableRow key={r.line} data-status={r.status}>
                        <TableCell className="tabular-nums">{r.line}</TableCell>
                        <TableCell>{r.userName}</TableCell>
                        <TableCell className="max-w-48 truncate">{r.description}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {r.start ? `${fmtTime(r.start)} – ${fmtTime(r.end)}` : ""}
                        </TableCell>
                        <TableCell className={r.status === "ok" ? "" : "text-destructive"}>
                          {r.status === "ok" ? "Ready" : r.error}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!file || busy}
            onClick={() => void check()}
          >
            {busy && !plan ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
            Check
          </Button>
          <Button
            type="button"
            disabled={!plan || plan.ok === 0 || busy}
            onClick={() => void commit()}
          >
            {busy && plan ? <Loader2Icon className="animate-spin" /> : null}
            Import {plan?.ok ?? 0} {plan?.ok === 1 ? "entry" : "entries"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
