"use client";

import { formatDateKey } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { fetchJson } from "@/lib/fetch-json";
import type { HolidayCountriesDTO, ImportCandidateDTO } from "@/lib/time-off-types";
import { importHolidaysAction } from "@/server/actions/time-off";

import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";

const ESTIMATED = "Estimated: confirm the proclaimed date";
const SELECT =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

type Row = ImportCandidateDTO & { label: string };

/**
 * Public holidays from the bundled dataset: pick a country (suggested from the
 * workspace timezone), a region and a year, review the list (untick days,
 * rename them), then import. Nothing is written before "Import".
 */
export function ImportHolidaysDialog({
  slug,
  year: initialYear,
  onClose,
}: {
  slug: string;
  year: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [region, setRegion] = useState("");
  const [year, setYear] = useState(String(initialYear));
  const [optional, setOptional] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  const base = useQuery({
    queryKey: [...timeOffKeys.all(slug), "countries"],
    queryFn: () => fetchJson<HolidayCountriesDTO>(timeOffUrls.countries(slug)),
  });
  const country = picked ?? base.data?.suggested ?? "";
  const regions = useQuery({
    queryKey: [...timeOffKeys.all(slug), "regions", country],
    queryFn: () => fetchJson<HolidayCountriesDTO>(timeOffUrls.countries(slug, country)),
    enabled: country !== "",
  });

  async function show() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ country, year });
      if (region) params.set("region", region);
      if (optional) params.set("optional", "1");
      const { candidates } = await fetchJson<{ candidates: ImportCandidateDTO[] }>(
        timeOffUrls.importPreview(slug, params.toString()),
      );
      setRows(candidates.map((c) => ({ ...c, label: c.name })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the holidays.");
    } finally {
      setBusy(false);
    }
  }

  const ticked = (rows ?? []).filter((r) => r.selected);

  async function commit() {
    setBusy(true);
    try {
      const result = await importHolidaysAction(slug, {
        country,
        region: region || null,
        year: Number(year),
        rows: ticked.map((r) => ({
          date: r.date,
          name: r.label.trim() || r.name,
          estimated: r.estimated,
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const n = result.data.added;
      toast.success(n === 1 ? "Imported 1 holiday" : `Imported ${n} holidays`);
      await qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev));

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import public holidays</DialogTitle>
          <DialogDescription>
            Pick a country and a year, then check the list before anything is added.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="import-country">Country</Label>
            <select
              id="import-country"
              className={SELECT}
              value={country}
              onChange={(e) => {
                setPicked(e.target.value);
                setRegion("");
                setRows(null);
              }}
            >
              {country === "" ? <option value="">Pick a country</option> : null}
              {(base.data?.countries ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-region">Region</Label>
            <select
              id="import-region"
              className={SELECT}
              value={region}
              disabled={(regions.data?.regions ?? []).length === 0}
              onChange={(e) => {
                setRegion(e.target.value);
                setRows(null);
              }}
            >
              <option value="">Whole country</option>
              {(regions.data?.regions ?? []).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-year">Year</Label>
            <Input
              id="import-year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setRows(null);
              }}
            />
          </div>
          <Label className="flex items-center gap-2 self-end pb-2 font-normal">
            <Checkbox
              aria-label="Include optional days and observances"
              checked={optional}
              onCheckedChange={(on) => {
                setOptional(on === true);
                setRows(null);
              }}
            />
            Include optional days and observances
          </Label>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !country || !/^\d{4}$/.test(year)}
          onClick={() => void show()}
        >
          Show holidays
        </Button>
        {rows ? (
          rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing new to import: every holiday of that year is already here.
            </p>
          ) : (
            <ul aria-label="Holidays to import" className="divide-y rounded-md border">
              {rows.map((r, i) => (
                <li key={`${r.date}-${r.name}`} className="flex flex-wrap items-center gap-2 p-2">
                  <Checkbox
                    aria-label={r.name}
                    checked={r.selected}
                    onCheckedChange={(on) => update(i, { selected: on === true })}
                  />
                  <span className="text-muted-foreground w-24 shrink-0 text-xs">
                    {formatDateKey(r.date)}
                  </span>
                  <Input
                    aria-label={`Name for ${formatDateKey(r.date)}`}
                    className="h-8 min-w-0 flex-1"
                    value={r.label}
                    maxLength={100}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                  {r.estimated ? <Badge variant="secondary">{ESTIMATED}</Badge> : null}
                  {r.existingName ? (
                    <span className="text-muted-foreground basis-full pl-6 text-xs">
                      Already imported as {r.existingName}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
        <p className="text-muted-foreground text-xs">Holiday data: date-holidays (CC BY 3.0)</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || ticked.length === 0}
            onClick={() => void commit()}
          >
            {ticked.length === 1 ? "Import 1 holiday" : `Import ${ticked.length} holidays`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
