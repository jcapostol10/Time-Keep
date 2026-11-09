import { type ReportQuery, reportQueryToSearchParams } from "@timekeep/core";

/**
 * The Expenses page opens on this month, not the reports' default week: a
 * URL without a preset means "this month" here. The server page and the
 * client compute the same key from the same URL.
 */
export function expensesQuery(query: ReportQuery, params: URLSearchParams): ReportQuery {
  return params.has("preset") ? query : { ...query, preset: "this-month" };
}

export function expensesParams(query: ReportQuery): string {
  return reportQueryToSearchParams(query).toString();
}
