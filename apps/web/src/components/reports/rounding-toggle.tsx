"use client";

import { roundingLabel } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { TimerResetIcon } from "lucide-react";

import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";
import { useReportOptions } from "./use-report";

/**
 * Shown only when the workspace rounds report time (decision 13): switches
 * the URL between the rule and raw time, so exports and share links follow.
 */
export function RoundingToggle() {
  const { slug } = useTracker();
  const { data: options } = useReportOptions(slug);
  const { query, set } = useReportQuery();
  const rule = options?.rounding ?? null;
  if (!rule) return null;
  const on = query.rounding === "on";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={on}
      onClick={() => set({ rounding: on ? "off" : "on" })}
    >
      <TimerResetIcon />
      {on ? `Rounding: ${roundingLabel(rule)}` : "Rounding: Raw"}
    </Button>
  );
}
