"use client";

import { Button } from "@timekeep/ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

/** Previous / Today / Next around a period label, shared by the timesheet and calendar. */
export function PeriodNav({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  onToday,
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" aria-label={previousLabel} onClick={onPrevious}>
        <ChevronLeftIcon />
      </Button>
      <Button variant="outline" size="icon" aria-label={nextLabel} onClick={onNext}>
        <ChevronRightIcon />
      </Button>
      <Button variant="outline" size="sm" onClick={onToday}>
        Today
      </Button>
      <span data-testid="period-label" className="ml-2 text-sm font-medium">
        {label}
      </span>
    </div>
  );
}
