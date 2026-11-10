/** Route helpers shared by server and client code. */

export const workspaceRoutes = {
  tracker: (slug: string) => `/w/${slug}/tracker`,
  timesheet: (slug: string) => `/w/${slug}/timesheet`,
  calendar: (slug: string) => `/w/${slug}/calendar`,
  dashboard: (slug: string) => `/w/${slug}/dashboard`,
  reports: (
    slug: string,
    kind?: "summary" | "detailed" | "weekly" | "audit" | "attendance" | "profit" | "expenses",
  ) => `/w/${slug}/reports${kind ? `/${kind}` : ""}`,
  projects: (slug: string) => `/w/${slug}/projects`,
  /** The Expenses page (Phase 6c); the Categories tab for those who manage them. */
  expenses: (slug: string, tab?: "categories") => `/w/${slug}/expenses${tab ? `?tab=${tab}` : ""}`,
  project: (
    slug: string,
    projectId: string,
    tab?: "access" | "status" | "settings" | "budget" | "rates",
  ) => `/w/${slug}/projects/${projectId}${tab ? `/${tab}` : ""}`,
  /** The Invoices page (Phase 6d) and its Recurring and Settings tabs. */
  invoices: (slug: string, tab?: "recurring" | "settings") =>
    `/w/${slug}/invoices${tab ? `?tab=${tab}` : ""}`,
  invoice: (slug: string, invoiceId: string) => `/w/${slug}/invoices/${invoiceId}`,
  team: (slug: string) => `/w/${slug}/team`,
  clients: (slug: string) => `/w/${slug}/clients`,
  tags: (slug: string) => `/w/${slug}/tags`,
  kiosks: (slug: string) => `/w/${slug}/kiosks`,
  settings: (slug: string) => `/w/${slug}/settings`,
  approvals: (slug: string, tab?: "pending" | "unsubmitted" | "archive" | "mine") =>
    `/w/${slug}/approvals${tab ? `?tab=${tab}` : ""}`,
  approval: (slug: string, requestId: string) => `/w/${slug}/approvals/${requestId}`,
  timeOff: (slug: string, tab?: "requests" | "calendar" | "balances" | "policies" | "holidays") =>
    `/w/${slug}/time-off${tab ? `?tab=${tab}` : ""}`,
} as const;

/**
 * Only allow same-origin relative paths as post-login destinations, so a
 * crafted ?next= cannot bounce users to another site.
 */
export function safeNextPath(value: string | string[] | undefined, fallback = "/"): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }
  return candidate;
}
