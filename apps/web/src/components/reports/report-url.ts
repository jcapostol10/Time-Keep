"use client";

import {
  parseReportQuery,
  type ReportKind,
  type ReportQuery,
  reportQueryToSearchParams,
} from "@timekeep/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { workspaceRoutes } from "@/lib/routes";

/**
 * The report query is the URL: any view is linkable, the back button works,
 * and the server page hydrates the same key the client computes.
 */
export function useReportQuery(): {
  query: ReportQuery;
  /** The canonical serialisation (defaults omitted): the react-query key and the API URL. */
  params: string;
  set: (patch: Partial<ReportQuery>) => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useMemo(
    () => parseReportQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const params = useMemo(() => reportQueryToSearchParams(query).toString(), [query]);
  const set = useCallback(
    (patch: Partial<ReportQuery>) => {
      const next = reportQueryToSearchParams({ ...query, ...patch }).toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [query, pathname, router],
  );
  return { query, params, set };
}

/** The same query on another report view. */
export function reportHref(slug: string, kind: ReportKind, params: string): string {
  return `${workspaceRoutes.reports(slug, kind)}${params ? `?${params}` : ""}`;
}
