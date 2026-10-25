import {
  type DrillStep,
  drillDownQuery,
  type ReportQuery,
  reportQueryToSearchParams,
} from "@timekeep/core";

import { workspaceRoutes } from "./routes";

/** The Detailed report's query string behind a group: the report's filters narrowed to it. */
export function detailedParams(
  query: ReportQuery,
  steps: DrillStep[],
  range: { from: string | Date; to: string | Date },
  timezone: string,
): string {
  const narrowed = drillDownQuery(
    query,
    steps,
    { from: new Date(range.from), to: new Date(range.to) },
    { timezone },
  );
  return reportQueryToSearchParams(narrowed).toString();
}

/** A link to the Detailed report behind a group. */
export function detailedHref(slug: string, params: string): string {
  return `${workspaceRoutes.reports(slug, "detailed")}${params ? `?${params}` : ""}`;
}
