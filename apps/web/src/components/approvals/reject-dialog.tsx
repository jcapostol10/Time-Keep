"use client";

import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Label } from "@timekeep/ui/components/label";
import { Textarea } from "@timekeep/ui/components/textarea";
import { useState } from "react";

/** Asks the reviewer what needs fixing: rejecting or reopening takes a note the person sees. */
export function RejectDialog({
  title,
  action,
  description = "The person sees this note and can correct their time and submit it again.",
  onClose,
  onSubmit,
}: {
  title: string;
  action: string;
  description?: string;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = note.trim();
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed.length < 3) return;
            setBusy(true);
            void onSubmit(trimmed).finally(() => setBusy(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="review-note">Note</Label>
            <Textarea
              id="review-note"
              value={note}
              maxLength={500}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || trimmed.length < 3}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
