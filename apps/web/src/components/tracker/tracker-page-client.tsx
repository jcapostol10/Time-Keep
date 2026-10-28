"use client";

import { EntryList } from "./entry-list";
import { PersonPicker } from "./person-picker";
import { useIsSaving } from "./saving-store";
import { useTarget } from "./target-context";
import { TimerBar } from "./timer-bar";

export function TrackerPageClient({ autoFocus }: { autoFocus: boolean }) {
  const saving = useIsSaving();
  const target = useTarget();
  return (
    <div className="space-y-6" data-saving={saving}>
      <TimerBar autoFocus={autoFocus} />
      <div className="flex flex-wrap items-center gap-3">
        <PersonPicker />
        {target ? (
          <p className="text-muted-foreground text-sm">
            Showing {target.name}&apos;s entries. The timer above is yours.
          </p>
        ) : null}
      </div>
      <EntryList />
    </div>
  );
}
