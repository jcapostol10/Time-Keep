"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { fetchJson } from "@/lib/fetch-json";
import type { RateDTO, RateRecalcDTO, RateTarget } from "@/lib/rate-types";

import { trackerKeys, trackerUrls } from "../tracker/query-keys";

/** The query string that names one rate level and target. */
export function rateTargetParams(target: RateTarget): string {
  const params = new URLSearchParams({ level: target.level });
  if (target.userId) params.set("userId", target.userId);
  if (target.projectId) params.set("projectId", target.projectId);
  if (target.taskId) params.set("taskId", target.taskId);
  return params.toString();
}

export function useRateHistory(slug: string, target: RateTarget, enabled: boolean) {
  const key = rateTargetParams(target);
  return useQuery({
    queryKey: trackerKeys.rates(slug, key),
    queryFn: () =>
      fetchJson<{ history: RateDTO[]; current: RateDTO | null }>(trackerUrls.rates(slug, key)),
    enabled,
  });
}

// The job this page started, so its banner says "Entries updated" for that
// job only (an older job of the workspace that finished long ago says nothing).
let watched: string | null = null;
const listeners = new Set<() => void>();
export function watchRateRecalc(jobId: string) {
  watched = jobId;
  for (const l of listeners) l();
}
function useWatchedRecalc(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => watched,
    () => null,
  );
}

/** The latest job, polled every 2 s while it waits or runs; reports refetch when it ends. */
export function useRateRecalc(slug: string) {
  const qc = useQueryClient();
  const watchedId = useWatchedRecalc();
  const query = useQuery({
    queryKey: trackerKeys.rateRecalc(slug),
    queryFn: () => fetchJson<{ job: RateRecalcDTO | null }>(trackerUrls.rateRecalc(slug)),
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === "queued" ||
        status === "running" ||
        (watchedId && q.state.data?.job?.id !== watchedId)
        ? 2_000
        : false;
    },
  });
  const job = query.data?.job ?? null;
  const finished = job?.status === "done" && job.id === watchedId;
  useEffect(() => {
    // Amounts changed: every report and the entry views refetch.
    if (finished) void qc.invalidateQueries({ queryKey: trackerKeys.allEntries(slug) });
  }, [finished, qc, slug]);
  return { job, watchedId };
}
