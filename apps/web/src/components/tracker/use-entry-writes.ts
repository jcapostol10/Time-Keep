"use client";

import type { EntryDetails, updateEntrySchema } from "@timekeep/core";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { z } from "zod";

import { withNoteRetry } from "@/components/approvals/note-prompt";
import type { TimeEntryDTO } from "@/lib/tracker-types";
import {
  createManualEntryAction,
  deleteEntriesAction,
  restoreEntriesAction,
  updateEntryAction,
} from "@/server/actions/time-entries";

import { trackerKeys } from "./query-keys";
import { insertIntoRange, patchRange, removeFromRange } from "./range-cache";
import { trackSave } from "./saving-store";
import { useTracker } from "./tracker-provider";
import { useTargetKey } from "./target-context";
import { useTrackerCache } from "./use-tracker-cache";

/** What callers send: ISO strings, which the action parses into instants. */
export type UpdateEntryPatch = z.input<typeof updateEntrySchema>;

const NOT_SAVED = "The change could not be saved.";

/** A range query's key: ["tracker", slug, "entries", userId, "range", from, to]. */
function rangeBounds(key: QueryKey): { from: string; to: string } | null {
  return key[4] === "range" && typeof key[5] === "string" && typeof key[6] === "string"
    ? { from: key[5], to: key[6] }
    : null;
}

/**
 * Entry writes for views that read through the range query (timesheet,
 * calendar): each runs its action under the saving indicator, toasts on
 * failure, and refetches every entry query (list, grid, calendar) on success.
 * Moves, resizes and deletes show at once in the person's ranges and go back
 * if the write is refused, cancelled at the note prompt, or fails to send.
 */
export function useEntryWrites() {
  const { slug, notifyEntriesChanged } = useTracker();
  const target = useTargetKey();
  const cache = useTrackerCache(slug, target);
  const qc = useQueryClient();

  /** Applies `change` to every loaded range of the person; returns the undo. */
  const patchRanges = useCallback(
    (change: (list: TimeEntryDTO[], bounds: { from: string; to: string }) => TimeEntryDTO[]) => {
      const before = qc.getQueriesData<TimeEntryDTO[]>({
        queryKey: trackerKeys.entries(slug, target),
      });
      for (const [key, data] of before) {
        const bounds = rangeBounds(key);
        if (bounds && data) qc.setQueryData(key, change(data, bounds));
      }
      return () => {
        for (const [key, data] of before) if (rangeBounds(key)) qc.setQueryData(key, data);
      };
    },
    [qc, slug, target],
  );

  const settle = useCallback(() => {
    void cache.invalidateEntries();
    void cache.invalidateOptions();
    notifyEntriesChanged();
  }, [cache, notifyEntriesChanged]);

  const createManual = useCallback(
    async (
      // The type defaults to work (the action's schema fills it).
      input: Omit<EntryDetails, "type"> & {
        type?: EntryDetails["type"];
        start: string;
        end: string;
      },
    ): Promise<TimeEntryDTO | null> => {
      const result = await trackSave(() =>
        withNoteRetry((note) =>
          createManualEntryAction(slug, {
            ...input,
            note,
            userId: target === "me" ? undefined : target,
          }),
        ),
      );
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      // Shown before the refetch lands, so a typed cell does not flick back.
      patchRanges((list, { from, to }) => insertIntoRange(list, result.data, from, to));
      settle();
      return result.data;
    },
    [slug, target, settle, patchRanges],
  );

  const update = useCallback(
    async (id: string, patch: UpdateEntryPatch): Promise<TimeEntryDTO | null> => {
      await qc.cancelQueries({ queryKey: trackerKeys.entries(slug, target) });
      const undo =
        typeof patch.start === "string" || typeof patch.end === "string"
          ? patchRanges((list) =>
              patchRange(list, id, {
                start: typeof patch.start === "string" ? patch.start : undefined,
                end: typeof patch.end === "string" ? patch.end : undefined,
              }),
            )
          : () => {};
      const result = await trackSave(() =>
        withNoteRetry((note) => updateEntryAction(slug, id, { ...patch, note })),
      ).catch(() => ({ ok: false as const, error: NOT_SAVED }));
      if (!result.ok) {
        undo();
        toast.error(result.error);
        return null;
      }
      settle();
      return result.data;
    },
    [qc, slug, target, settle, patchRanges],
  );

  const restore = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const result = await trackSave(() =>
        withNoteRetry((note) => restoreEntriesAction(slug, { ids, note })),
      );
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      settle();
      return true;
    },
    [slug, settle],
  );

  /** Soft delete with a 5-second Undo toast, like the tracker list's. */
  const remove = useCallback(
    async (ids: string[]): Promise<boolean> => {
      await qc.cancelQueries({ queryKey: trackerKeys.entries(slug, target) });
      const undo = patchRanges((list) => removeFromRange(list, ids));
      const result = await trackSave(() =>
        withNoteRetry((note) => deleteEntriesAction(slug, { ids, note })),
      ).catch(() => ({ ok: false as const, error: NOT_SAVED }));
      if (!result.ok) {
        undo();
        toast.error(result.error);
        return false;
      }
      settle();
      toast(ids.length === 1 ? "Entry deleted" : `${ids.length} entries deleted`, {
        duration: 5000,
        action: { label: "Undo", onClick: () => void restore(ids) },
      });
      return true;
    },
    [qc, slug, target, settle, restore, patchRanges],
  );

  return useMemo(
    () => ({ createManual, update, remove, settle }),
    [createManual, update, remove, settle],
  );
}
