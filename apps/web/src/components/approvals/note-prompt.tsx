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
import { useState, useSyncExternalStore } from "react";

import type { ActionResult } from "@/lib/action-result";

/**
 * Phase 5a decision 5: an owner or admin changing time in a submitted or
 * approved period says why. The server answers such a write without a note
 * with `fieldErrors.note`; `withNoteRetry` then asks once through the dialog
 * that `NotePromptHost` (in the workspace layout) shows, and sends the write
 * again with the note. Cancelling leaves the time unchanged.
 */

type Pending = { resolve: (note: string | null) => void } | null;

let pending: Pending = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Opens the dialog; resolves with the note, or null when cancelled. */
export function askForNote(): Promise<string | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = {
      resolve: (note) => {
        pending = null;
        emit();
        resolve(note);
      },
    };
    emit();
  });
}

/** True when the server wants a note for this write. */
export function needsNote(result: { ok: boolean; fieldErrors?: Record<string, string[]> }) {
  return !result.ok && Boolean(result.fieldErrors?.note);
}

/** Runs an entry action; when the server asks for a note, asks for it and runs it again once. */
export async function withNoteRetry<T>(
  call: (note?: string) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const first = await call();
  if (!needsNote(first)) return first;
  const note = await askForNote();
  if (note === null) return { ok: false, error: "Not changed: no reason was given." };
  return call(note);
}

const MIN_NOTE = 3;

export function NotePromptHost() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => null,
  );
  return current ? <NoteDialog key="note" onDone={current.resolve} /> : null;
}

function NoteDialog({ onDone }: { onDone: (note: string | null) => void }) {
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onDone(null))}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed.length >= MIN_NOTE) onDone(trimmed);
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Why are you changing submitted time?</DialogTitle>
            <DialogDescription>
              This time is submitted for approval or approved. Your reason is kept in the
              period&apos;s history with the change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="change-note">Note</Label>
            <Textarea
              id="change-note"
              value={note}
              maxLength={500}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed.length < MIN_NOTE}>
              Save change
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
