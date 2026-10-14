"use client";

import { computeDurationSeconds } from "@timekeep/core";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import type { EntryDraft, TimeEntryDTO } from "@/lib/tracker-types";
import {
  createManualEntryAction,
  deleteEntriesAction,
  duplicateEntryAction,
  restoreEntriesAction,
  updateEntryAction,
} from "@/server/actions/time-entries";

import { useTracker } from "./tracker-provider";
import { useTrackerCache } from "./use-tracker-cache";

export type EntryPatch = Partial<EntryDraft> & { start?: string; end?: string };

const UNDO_MS = 5000;

/** Entry mutations with cache updates; every success is broadcast to other tabs. */
export function useEntryMutations() {
  const { slug, notifyEntriesChanged } = useTracker();
  const cache = useTrackerCache(slug);

  const createManual = useCallback(
    async (input: EntryDraft & { start: string; end: string }) => {
      const result = await createManualEntryAction(slug, input);
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      cache.upsertEntry(result.data, "insert");
      void cache.invalidateOptions();
      notifyEntriesChanged();
      toast.success("Entry added");
      return true;
    },
    [slug, cache, notifyEntriesChanged],
  );

  /** Optimistic inline edit; rolls back and explains on failure. */
  const update = useCallback(
    async (entry: TimeEntryDTO, patch: EntryPatch) => {
      const snapshot = await cache.snapshotEntries();
      const start = patch.start ?? entry.start;
      const end = patch.end ?? entry.end;
      cache.patchEntry(entry.id, {
        ...patch,
        ...cache.resolveDetails(patch),
        ...(end ? { durationSeconds: computeDurationSeconds(new Date(start), new Date(end)) } : {}),
      });
      const result = await updateEntryAction(slug, entry.id, patch);
      if (!result.ok) {
        cache.restoreEntries(snapshot);
        toast.error(result.error);
        return false;
      }
      cache.upsertEntry(result.data);
      if (patch.description !== undefined) void cache.invalidateOptions();
      notifyEntriesChanged();
      return true;
    },
    [slug, cache, notifyEntriesChanged],
  );

  const restore = useCallback(
    async (ids: string[]) => {
      const result = await restoreEntriesAction(slug, { ids });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      await cache.invalidateEntries();
      notifyEntriesChanged();
      return true;
    },
    [slug, cache, notifyEntriesChanged],
  );

  /** Soft delete with a 5-second Undo toast. */
  const remove = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return false;
      const snapshot = await cache.snapshotEntries();
      cache.removeEntries(ids);
      const result = await deleteEntriesAction(slug, { ids });
      if (!result.ok) {
        cache.restoreEntries(snapshot);
        toast.error(result.error);
        return false;
      }
      notifyEntriesChanged();
      const deleted = result.data.deleted;
      toast(deleted.length === 1 ? "Entry deleted" : `${deleted.length} entries deleted`, {
        duration: UNDO_MS,
        action: { label: "Undo", onClick: () => void restore(deleted) },
      });
      return true;
    },
    [slug, cache, notifyEntriesChanged, restore],
  );

  const duplicate = useCallback(
    async (entryId: string) => {
      const result = await duplicateEntryAction(slug, entryId);
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      cache.upsertEntry(result.data, "insert");
      notifyEntriesChanged();
      toast.success("Entry duplicated");
      return true;
    },
    [slug, cache, notifyEntriesChanged],
  );

  return useMemo(
    () => ({ createManual, update, remove, restore, duplicate }),
    [createManual, update, remove, restore, duplicate],
  );
}
