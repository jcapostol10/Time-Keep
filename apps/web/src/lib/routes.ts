/** Route helpers shared by server and client code. */

export const workspaceRoutes = {
  tracker: (slug: string) => `/w/${slug}/tracker`,
  timesheet: (slug: string) => `/w/${slug}/timesheet`,
  calendar: (slug: string) => `/w/${slug}/calendar`,
  dashboard: (slug: string) => `/w/${slug}/dashboard`,
  reports: (slug: string) => `/w/${slug}/reports`,
  projects: (slug: string) => `/w/${slug}/projects`,
  team: (slug: string) => `/w/${slug}/team`,
  clients: (slug: string) => `/w/${slug}/clients`,
  tags: (slug: string) => `/w/${slug}/tags`,
  settings: (slug: string) => `/w/${slug}/settings`,
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
