"use client";

import { LockNotice } from "@/components/approvals/lock-notice";
import { PeriodBar } from "@/components/approvals/period-bar";

import { EntryList } from "./entry-list";
import { FavoritesStrip } from "./favorites-strip";
import { PersonPicker } from "./person-picker";
import { useIsSaving } from "./saving-store";
import { useTarget } from "./target-context";
import { TimerBar } from "./timer-bar";

export function TrackerPageClient({
  autoFocus,
  periodRange,
}: {
  autoFocus: boolean;
  /** Last week and this one: the approval periods shown above the list. */
  periodRange: { from: string; to: string };
}) {
  const saving = useIsSaving();
  const target = useTarget();
  return (
    <div className="space-y-6" data-saving={saving}>
      <TimerBar autoFocus={autoFocus} />
      <FavoritesStrip />
      <LockNotice />
      {target ? null : <PeriodBar from={periodRange.from} to={periodRange.to} />}
      <EntryList
        header={
          <>
            <PersonPicker />
            {target ? (
              <p className="text-muted-foreground text-sm">
                Showing {target.name}&apos;s entries. The timer above is yours.
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}
