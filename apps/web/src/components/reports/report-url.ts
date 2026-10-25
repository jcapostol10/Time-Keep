"use client";

import {
  parseReportQuery,
  type ReportKind,
  type ReportQuery,
  reportQueryToSearchParams,
} from "@timekeep/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

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
  const current = searchParams.toString();
  const fromUrl = useMemo(() => parseReportQuery(new URLSearchParams(current)), [current]);
  // A change shows at once and a second change builds on it, even before the
  // first navigation lands: until the URL moves, the pending query is the query.
  const [pending, setPending] = useState<{ base: string; query: ReportQuery } | null>(null);
  const query = pending && pending.base === current ? pending.query : fromUrl;
  const params = useMemo(() => reportQueryToSearchParams(fromUrl).toString(), [fromUrl]);
  const set = useCallback(
    (patch: Partial<ReportQuery>) => {
      const nextQuery = { ...query, ...patch };
      setPending({ base: current, query: nextQuery });
      const next = reportQueryToSearchParams(nextQuery).toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [query, current, pathname, router],
  );
  return { query, params, set };
}

/** The same query on another report view. */
export function reportHref(slug: string, kind: ReportKind, params: string): string {
  return `${workspaceRoutes.reports(slug, kind)}${params ? `?${params}` : ""}`;
}
