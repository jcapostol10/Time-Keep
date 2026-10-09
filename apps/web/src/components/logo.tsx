import { cn } from "@timekeep/ui/lib/utils";

/** Wordmark + mark. Our own brand; no third-party assets. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && <span className="text-base">TimeKeep</span>}
    </span>
  );
}
