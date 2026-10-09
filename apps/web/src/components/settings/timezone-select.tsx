"use client";

import { FormControl } from "@timekeep/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { useMemo } from "react";

function allTimeZones(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** IANA timezone picker; `value` of "" means "inherit" when `allowInherit` is set. */
export function TimezoneSelect({
  value,
  onChange,
  allowInherit,
  inheritLabel = "Use workspace default",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const zones = useMemo(() => allTimeZones(), []);
  const INHERIT = "__inherit__";

  return (
    <Select
      value={value ?? (allowInherit ? INHERIT : "UTC")}
      onValueChange={(v) => onChange(v === INHERIT ? null : v)}
    >
      <FormControl>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
      </FormControl>
      <SelectContent className="max-h-72">
        {allowInherit ? <SelectItem value={INHERIT}>{inheritLabel}</SelectItem> : null}
        {zones.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz.replaceAll("_", " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
