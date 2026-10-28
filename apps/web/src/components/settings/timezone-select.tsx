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
import { useFormContext } from "react-hook-form";

function allTimeZones(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/**
 * IANA timezone picker; `value` of "" means "inherit" when `allowInherit` is
 * set. Inside a form field it takes the field's labelling through
 * `FormControl`; elsewhere (the import dialog) it labels itself.
 */
export function TimezoneSelect({
  value,
  onChange,
  allowInherit,
  inheritLabel = "Use workspace default",
  ariaLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  allowInherit?: boolean;
  inheritLabel?: string;
  ariaLabel?: string;
}) {
  const zones = useMemo(() => allTimeZones(), []);
  const INHERIT = "__inherit__";
  // Null outside a FormProvider, where FormControl would throw.
  const inForm = useFormContext() !== null;
  const trigger = (
    <SelectTrigger className="w-full" aria-label={ariaLabel}>
      <SelectValue />
    </SelectTrigger>
  );

  return (
    <Select
      value={value ?? (allowInherit ? INHERIT : "UTC")}
      onValueChange={(v) => onChange(v === INHERIT ? null : v)}
    >
      {inForm ? <FormControl>{trigger}</FormControl> : trigger}
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
