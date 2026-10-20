"use client";

import { useQuery } from "@tanstack/react-query";

import type { TimesheetTemplateDTO } from "@/lib/catalog-types";
import { fetchJson } from "@/lib/fetch-json";
import type { TimeEntryDTO } from "@/lib/tracker-types";

import { trackerKeys, trackerUrls } from "../tracker/query-keys";

/** The viewer's stopped entries starting in [from, to); hydrated by the page. */
export function useRangeEntries(slug: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: trackerKeys.range(slug, from, to),
    queryFn: async () =>
      (await fetchJson<{ entries: TimeEntryDTO[] }>(trackerUrls.range(slug, from, to))).entries,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useTemplates(slug: string) {
  return useQuery({
    queryKey: trackerKeys.templates(slug),
    queryFn: async () =>
      (await fetchJson<{ templates: TimesheetTemplateDTO[] }>(trackerUrls.templates(slug)))
        .templates,
    staleTime: 60_000,
  });
}
