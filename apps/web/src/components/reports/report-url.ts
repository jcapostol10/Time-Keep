"use client";

import {
  parseReportQuery,
  type ReportQuery,
  reportQueryToSearchParams,
  type ReportView,
} from "@timekeep/core";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { workspaceRoutes } from "@/lib/routes";

/**
 * The report query is the URL: any view is linkable, Back undoes a filter
 * change, and the server page hydrates the same key the client computes.
 */
export function useReportQuery(): {
  query: ReportQuery;
  /** The canonical serialisation (defaults omitted): the react-query key and the API URL. */
  params: string;
  /** A new history entry per change; `replace` for typing, so Back skips each keystroke. */
  set: (patch: Partial<ReportQuery>, options?: { replace?: boolean }) => void;
} {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const current = searchParams.toString();
  const fromUrl = useMemo(() => parseReportQuery(new URLSearchParams(current)), [current]);
  // A change shows at once and a second change builds on it, even before the
  // first navigation lands: until the URL moves, the pending query is the query.
  // Once the URL has moved the pending query is spent: Back to its base must show
  // the base's query, not the change made from it.
  const [pending, setPending] = useState<{ base: string; query: ReportQuery } | null>(null);
  if (pending && pending.base !== current) setPending(null);
  const query = pending && pending.base === current ? pending.query : fromUrl;
  const params = useMemo(() => reportQueryToSearchParams(fromUrl).toString(), [fromUrl]);
  const set = useCallback(
    (patch: Partial<ReportQuery>, options?: { replace?: boolean }) => {
      const nextQuery = { ...query, ...patch };
      setPending({ base: current, query: nextQuery });
      const next = reportQueryToSearchParams(nextQuery).toString();
      // History API, not router.replace: Next keeps useSearchParams in step without a
      // server render of the page; react-query fetches the new report on its own.
      const url = next ? `${pathname}?${next}` : pathname;
      if (options?.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    [query, current, pathname],
  );
  return { query, params, set };
}

/** The same query on another report view. */
export function reportHref(slug: string, kind: ReportView, params: string): string {
  return `${workspaceRoutes.reports(slug, kind)}${params ? `?${params}` : ""}`;
}
