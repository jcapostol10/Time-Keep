"use client";

import { formatMoney } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { useState } from "react";

import type { RateTarget } from "@/lib/rate-types";

import { RateDialog } from "./rate-dialog";

/** The rate in force at one level, with a button that opens its dialog. */
export function RateCell({
  slug,
  target,
  title,
  currency,
  timezone,
  current,
  buttonLabel = "Change rate",
  ariaLabel,
  inherited = "No rate",
}: {
  slug: string;
  target: RateTarget;
  title: string;
  currency: string;
  timezone: string;
  /** Minor units per hour in force now, or null. */
  current: number | null;
  buttonLabel?: string;
  /** The button's accessible name when the label alone is ambiguous (one per row). */
  ariaLabel?: string;
  /** What "no rate here" means at this level (e.g. "Uses the project rate"). */
  inherited?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={current === null ? "text-muted-foreground text-sm" : "tabular-nums"}>
        {current === null ? inherited : `${formatMoney(current, currency)} / h`}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </Button>
      <RateDialog
        slug={slug}
        target={target}
        title={title}
        currency={currency}
        timezone={timezone}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
