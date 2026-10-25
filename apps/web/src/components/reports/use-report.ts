"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/lib/fetch-json";
import {
  type DetailedCursor,
  type DetailedPage,
  type DetailedPaging,
  detailedKey,
  type ReportFilterOptions,
  type SummaryReport,
  type WeeklyBy,
  type WeeklyReport,
} from "@/lib/report-types";

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

function detailedUrl(params: string, paging: DetailedPaging, cursor: DetailedCursor | null) {
  const search = new URLSearchParams(params);
  search.set("sort", paging.sort);
  search.set("dir", paging.dir);
  search.set("limit", String(paging.limit));
  if (cursor) {
    search.set("cursorValue", cursor.value);
    search.set("cursorId", cursor.id);
  }
  return search.toString();
}

/** Keyset pages of the Detailed report; an entry write refetches from the first page. */
export function useDetailed(slug: string, params: string, paging: DetailedPaging) {
  return useInfiniteQuery({
    queryKey: trackerKeys.report(slug, "detailed", detailedKey(params, paging)),
    queryFn: ({ pageParam }) =>
      fetchJson<DetailedPage>(
        trackerUrls.report(slug, "detailed", detailedUrl(params, paging, pageParam)),
      ),
    initialPageParam: null as DetailedCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

/** The Weekly grid for the week containing the query's range start. */
export function useWeekly(slug: string, params: string, by: WeeklyBy) {
  const search = new URLSearchParams(params);
  search.set("by", by);
  return useQuery({
    queryKey: trackerKeys.report(slug, "weekly", `${params}|${by}`),
    queryFn: () => fetchJson<WeeklyReport>(trackerUrls.report(slug, "weekly", search.toString())),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}
