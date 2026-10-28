"use client";

import type { EntryDetails, updateEntrySchema } from "@timekeep/core";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { z } from "zod";

import type { TimeEntryDTO } from "@/lib/tracker-types";
import {
  createManualEntryAction,
  deleteEntriesAction,
  restoreEntriesAction,
  updateEntryAction,
} from "@/server/actions/time-entries";

import { trackSave } from "./saving-store";
import { useTracker } from "./tracker-provider";
import { useTrackerCache } from "./use-tracker-cache";

/** What callers send: ISO strings, which the action parses into instants. */
export type UpdateEntryPatch = z.input<typeof updateEntrySchema>;

/**
 * Entry writes for views that read through the range query (timesheet,
 * calendar): each runs its action under the saving indicator, toasts on
 * failure, and refetches every entry query (list, grid, calendar) on success.
 */
export function useEntryWrites() {
  const { slug, notifyEntriesChanged } = useTracker();
  const cache = useTrackerCache(slug);

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
      const result = await trackSave(() => createManualEntryAction(slug, input));
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      settle();
      return result.data;
    },
    [slug, settle],
  );

  const update = useCallback(
    async (id: string, patch: UpdateEntryPatch): Promise<TimeEntryDTO | null> => {
      const result = await trackSave(() => updateEntryAction(slug, id, patch));
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      settle();
      return result.data;
    },
    [slug, settle],
  );

  const restore = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const result = await trackSave(() => restoreEntriesAction(slug, { ids }));
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
      const result = await trackSave(() => deleteEntriesAction(slug, { ids }));
      if (!result.ok) {
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
    [slug, settle, restore],
  );

  return useMemo(
    () => ({ createManual, update, remove, settle }),
    [createManual, update, remove, settle],
  );
}
