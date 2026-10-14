"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import type { EntryDraft } from "@/lib/tracker-types";
import { createManualEntryAction } from "@/server/actions/time-entries";

import { useTracker } from "./tracker-provider";
import { useTrackerCache } from "./use-tracker-cache";

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

  return useMemo(() => ({ createManual }), [createManual]);
}
