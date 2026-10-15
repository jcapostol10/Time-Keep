"use client";

import { EntryList } from "./entry-list";
import { useIsSaving } from "./saving-store";
import { TimerBar } from "./timer-bar";

export function TrackerPageClient({ autoFocus }: { autoFocus: boolean }) {
  const saving = useIsSaving();
  return (
    <div className="space-y-6" data-saving={saving}>
      <TimerBar autoFocus={autoFocus} />
      <EntryList />
    </div>
  );
}
