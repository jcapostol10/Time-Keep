"use client";

import { LockIcon } from "lucide-react";

import { useTracker } from "../tracker/tracker-provider";

/** "Entries before … are locked." where the lock binds the viewer (spec Part 2). */
export function LockNotice() {
  const { rules } = useTracker();
  if (!rules.lockNotice) return null;
  return (
    <p role="note" className="text-muted-foreground flex items-center gap-2 text-sm">
      <LockIcon className="size-4 shrink-0" aria-hidden />
      {rules.lockNotice}
    </p>
  );
}
