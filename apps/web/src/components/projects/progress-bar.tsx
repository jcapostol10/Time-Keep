import { type DurationFormat, formatDuration, formatMoney, type Progress } from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";

/** "2:00:00 of 10:00:00 · 20%" or "$50.00 of $200.00 · 25%". */
export function progressText(progress: Progress, durationFormat: DurationFormat): string {
  const fmt = (value: number) =>
    progress.kind === "TIME"
      ? formatDuration(value, durationFormat)
      : formatMoney(value, progress.currency ?? "USD");
  return `${fmt(progress.used)} of ${fmt(progress.estimate)} · ${progress.percent}%`;
}

/**
 * A project's budget progress (Phase 6b): the fill is capped at the full
 * width, the label says the real percent; amber from 80%, red from 100%.
 */
export function ProgressBar({
  progress,
  durationFormat,
  size = "sm",
  className,
}: {
  progress: Progress;
  durationFormat: DurationFormat;
  size?: "sm" | "lg";
  className?: string;
}) {
  const width = Math.min(progress.percent, 100);
  const tone =
    progress.percent >= 100
      ? "bg-destructive"
      : progress.percent >= 80
        ? "bg-amber-500"
        : "bg-primary";
  return (
    <div className={cn("space-y-1", className)}>
      <div
        role="progressbar"
        aria-valuenow={Math.min(progress.percent, 999)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${progress.percent}% of estimate`}
        className={cn("bg-muted overflow-hidden rounded-full", size === "lg" ? "h-3" : "h-1.5")}
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
      </div>
      <p
        className={cn("text-muted-foreground tabular-nums", size === "lg" ? "text-sm" : "text-xs")}
      >
        {progressText(progress, durationFormat)}
        {progress.period.label ? ` · Resets monthly · ${progress.period.label}` : null}
      </p>
    </div>
  );
}
