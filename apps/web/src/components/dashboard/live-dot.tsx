/**
 * "Tracking now" on Team activity: the live colour's dot, beside ink text.
 * One of the few places `--live` may appear (see `live-token.test.ts`).
 */
export function LiveDot({ label }: { label: string }) {
  return (
    <span className="text-foreground flex items-center gap-1.5 text-xs font-medium">
      <span className="bg-live size-2 animate-pulse rounded-full" aria-hidden />
      {label}
    </span>
  );
}
