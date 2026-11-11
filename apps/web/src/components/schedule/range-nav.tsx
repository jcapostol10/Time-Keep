"use client";

import { formatTimeOffDates } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { type Zoom, ZOOM_LABELS } from "./schedule-model";

/** Previous, Today, Next, the range's dates, and (when given) the zoom. */
export function RangeNav({
  range,
  zoom,
  zooms,
  onShift,
  onToday,
  onZoom,
}: {
  range: { from: string; to: string };
  zoom: Zoom;
  zooms: readonly Zoom[];
  onShift: (direction: 1 | -1) => void;
  onToday: () => void;
  onZoom: (zoom: Zoom) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Previous" onClick={() => onShift(-1)}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button variant="outline" onClick={onToday}>
          Today
        </Button>
        <Button variant="outline" size="icon" aria-label="Next" onClick={() => onShift(1)}>
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
      <p className="text-sm font-medium" aria-live="polite">
        {formatTimeOffDates(range.from, range.to)}
      </p>
      {zooms.length > 1 ? (
        <div role="radiogroup" aria-label="Zoom" className="ml-auto flex rounded-md border p-0.5">
          {zooms.map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={zoom === z}
              className={
                zoom === z
                  ? "bg-primary text-primary-foreground rounded px-2.5 py-1 text-sm"
                  : "text-muted-foreground rounded px-2.5 py-1 text-sm"
              }
              onClick={() => onZoom(z)}
            >
              {ZOOM_LABELS[z]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
