"use client";

import { TimerBar } from "./timer-bar";

export function TrackerPageClient({ autoFocus }: { autoFocus: boolean }) {
  return (
    <div className="space-y-6">
      <TimerBar autoFocus={autoFocus} />
    </div>
  );
}
