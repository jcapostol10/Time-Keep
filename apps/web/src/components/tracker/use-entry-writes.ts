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

/**
 * Optimistic writes not yet settled, across every view of the tab. A refused
 * write refetches only when it is the last one: an earlier refetch would bring
 * back the server's rows under a later write still queued (server actions run
 * one at a time), and that write's own settle refetches when it lands.
 */
let optimisticInFlight = 0;

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

  /** Applies `change` to every loaded range of the person. */
  const patchRanges = useCallback(
    (change: (list: TimeEntryDTO[], bounds: { from: string; to: string }) => TimeEntryDTO[]) => {
      for (const [key, data] of qc.getQueriesData<TimeEntryDTO[]>({
        queryKey: trackerKeys.entries(slug, target),
      })) {
        const bounds = rangeBounds(key);
        if (bounds && data) qc.setQueryData(key, change(data, bounds));
      }
    },
    [qc, slug, target],
  );

  /**
   * Changes the given entries in every loaded range and returns their undo: it
   * puts back only those entries as they were (another write made meanwhile
   * keeps its change), then refetches, so the view ends on the server's rows.
   */
  const optimistic = useCallback(
    (ids: string[], change: (list: TimeEntryDTO[]) => TimeEntryDTO[]) => {
      const wanted = new Set(ids);
      const before = new Map<string, TimeEntryDTO>();
      for (const [key, data] of qc.getQueriesData<TimeEntryDTO[]>({
        queryKey: trackerKeys.entries(slug, target),
      })) {
        if (!rangeBounds(key)) continue;
        for (const e of data ?? []) if (wanted.has(e.id)) before.set(e.id, e);
      }
      patchRanges((list) => change(list));
      optimisticInFlight += 1;
      let open = true;
      const done = () => {
        if (open) optimisticInFlight -= 1;
        open = false;
      };
      return {
        /** The write landed: its settle refetches. */
        done,
        /** The write was refused: put the entries back, and refetch if nothing else is pending. */
        undo: () => {
          done();
          patchRanges((list, { from, to }) => {
            let next = list.map((e) => before.get(e.id) ?? e);
            for (const e of before.values()) next = insertIntoRange(next, e, from, to);
            return next;
          });
          if (optimisticInFlight === 0) void cache.invalidateEntries();
        },
      };
    },
    [qc, slug, target, patchRanges, cache],
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
      const write =
        typeof patch.start === "string" || typeof patch.end === "string"
          ? optimistic([id], (list) =>
              patchRange(list, id, {
                start: typeof patch.start === "string" ? patch.start : undefined,
                end: typeof patch.end === "string" ? patch.end : undefined,
              }),
            )
          : null;
      const result = await trackSave(() =>
        withNoteRetry((note) => updateEntryAction(slug, id, { ...patch, note })),
      ).catch(() => ({ ok: false as const, error: NOT_SAVED }));
      if (!result.ok) {
        write?.undo();
        toast.error(result.error);
        return null;
      }
      write?.done();
      settle();
      return result.data;
    },
    [qc, slug, target, settle, optimistic],
  );

  const restore = useCallback(
    async (ids: string[], note?: string): Promise<boolean> => {
      const result = await trackSave(() =>
        withNoteRetry((n) => restoreEntriesAction(slug, { ids, note: n }), note),
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
      const write = optimistic(ids, (list) => removeFromRange(list, ids));
      let usedNote: string | undefined;
      const result = await trackSave(() =>
        withNoteRetry((note) => {
          usedNote = note;
          return deleteEntriesAction(slug, { ids, note });
        }),
      ).catch(() => ({ ok: false as const, error: NOT_SAVED }));
      if (!result.ok) {
        write.undo();
        toast.error(result.error);
        return false;
      }
      write.done();
      settle();
      toast(ids.length === 1 ? "Entry deleted" : `${ids.length} entries deleted`, {
        duration: 5000,
        action: { label: "Undo", onClick: () => void restore(ids, usedNote) },
      });
      return true;
    },
    [qc, slug, target, settle, restore, optimistic],
  );

  return useMemo(
    () => ({ createManual, update, remove, settle }),
    [createManual, update, remove, settle],
  );
}
