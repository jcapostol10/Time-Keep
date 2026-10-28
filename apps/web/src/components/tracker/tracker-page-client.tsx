"use client";

import { Button } from "@timekeep/ui/components/button";
import { FileUpIcon } from "lucide-react";
import { useState } from "react";

import { EntryList } from "./entry-list";
import { FavoritesStrip } from "./favorites-strip";
import { ImportDialog } from "./import-dialog";
import { PersonPicker } from "./person-picker";
import { useIsSaving } from "./saving-store";
import { useTarget } from "./target-context";
import { TimerBar } from "./timer-bar";

export function TrackerPageClient({ autoFocus }: { autoFocus: boolean }) {
  const saving = useIsSaving();
  const target = useTarget();
  const [importing, setImporting] = useState(false);
  return (
    <div className="space-y-6" data-saving={saving}>
      <TimerBar autoFocus={autoFocus} />
      <FavoritesStrip />
      <div className="flex flex-wrap items-center gap-3">
        <PersonPicker />
        <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
          <FileUpIcon /> Import
        </Button>
        <ImportDialog open={importing} onOpenChange={setImporting} />
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
