"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/lib/fetch-json";
import type { ReportFilterOptions, SummaryReport } from "@/lib/report-types";

import { trackerKeys, trackerUrls } from "../tracker/query-keys";

/** The Summary for a serialised query; hydrated by the page, refetched on every entry write. */
export function useSummary(slug: string, params: string) {
  return useQuery({
    queryKey: trackerKeys.report(slug, "summary", params),
    queryFn: () => fetchJson<SummaryReport>(trackerUrls.report(slug, "summary", params)),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    // Keep the last report on screen while a changed filter loads.
    placeholderData: keepPreviousData,
  });
}

export function useReportOptions(slug: string) {
  return useQuery({
    queryKey: trackerKeys.reportOptions(slug),
    queryFn: () => fetchJson<ReportFilterOptions>(trackerUrls.reportOptions(slug)),
    staleTime: 60_000,
  });
}
