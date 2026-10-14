"use client";

import { formatClock, formatTimeOfDay } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { useState } from "react";

import { useTracker, useTrackerClock } from "./tracker-provider";

/** Shown when the user returns after idle time while a timer runs. */
export function IdleDialog({
  idleSince,
  onClose,
}: {
  idleSince: Date | null;
  onClose: () => void;
}) {
  const { running, viewer, stop, start } = useTracker();
  const { now } = useTrackerClock();
  const [busy, setBusy] = useState(false);
  const open = Boolean(idleSince && running);
  if (!idleSince || !running) return null;

  const startedAt = Date.parse(running.start);
  const cut = new Date(Math.max(idleSince.getTime(), startedAt + 1000));
  const idleSeconds = Math.max(0, Math.round((now - cut.getTime()) / 1000));

  async function discard(andStartNew: boolean) {
    if (!running) return;
    setBusy(true);
    const details = {
      description: running.description,
      projectId: running.projectId,
      taskId: running.taskId,
      tagIds: running.tagIds,
      billable: running.billable,
    };
    const stopped = await stop(cut);
    if (stopped && andStartNew) await start(details);
    setBusy(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>You were idle for {formatClock(idleSeconds)}</DialogTitle>
          <DialogDescription>
            Your timer for &ldquo;{running.description || "(no description)"}&rdquo; kept running
            since {formatTimeOfDay(cut, viewer.timezone, viewer.timeFormat)}. What should happen to
            that time?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col sm:items-stretch">
          <Button onClick={onClose} disabled={busy}>
            Keep time
          </Button>
          <Button variant="outline" onClick={() => void discard(false)} disabled={busy}>
            Discard idle time
          </Button>
          <Button variant="outline" onClick={() => void discard(true)} disabled={busy}>
            Discard and start new
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
