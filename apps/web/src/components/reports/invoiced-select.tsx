"use client";

import type { ReportQuery } from "@timekeep/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";

/** The invoiced filter (Phase 6d): everything, time or expenses on an invoice, or not yet invoiced. */
export function InvoicedSelect({
  value,
  onChange,
}: {
  value: ReportQuery["invoiced"];
  onChange: (value: ReportQuery["invoiced"]) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v === "yes" ? "yes" : v === "no" ? "no" : "all")}
    >
      <SelectTrigger size="sm" aria-label="Invoiced" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Invoiced: all</SelectItem>
        <SelectItem value="yes">Invoiced</SelectItem>
        <SelectItem value="no">Not invoiced</SelectItem>
      </SelectContent>
    </Select>
  );
}
