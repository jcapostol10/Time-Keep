import "server-only";

import {
  type Action,
  isoInstantSchema,
  parseReportQuery,
  type ReportQuery,
  type Resource,
  resolveViewerPrefs,
  type ViewerPrefs,
} from "@timekeep/core";
import { type Database, getDb } from "@timekeep/db";
import { z } from "zod";

import type { DetailedSort } from "@/lib/report-types";

import type { Viewer } from "./catalog/viewer";
import { authorize } from "./authz";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
  type WorkspaceContext,
} from "./workspace-access";

const pageSchema = z.object({
  sort: z.enum(["start", "duration"]).default("start"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  cursorValue: z.string().min(1).optional(),
  cursorId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export interface DetailedPageParams {
  sort: DetailedSort;
  dir: "asc" | "desc";
  cursor?: { value: string; id: string };
  limit?: number;
}

/**
 * The Detailed route's paging. Bad sort or limit values fall back to the
 * defaults; a cursor must match its sort (an instant for start, whole
 * seconds for duration), since it goes into the query.
 */
export function detailedPageFromParams(params: URLSearchParams): DetailedPageParams {
  const parsed = pageSchema.safeParse(Object.fromEntries(params));
  const page = parsed.success ? parsed.data : pageSchema.parse({});
  const value = params.get("cursorValue");
  const id = params.get("cursorId");
  if (!value || !id) return { sort: page.sort, dir: page.dir, limit: page.limit };
  const valid =
    page.sort === "duration" ? /^\d{1,10}$/.test(value) : isoInstantSchema.safeParse(value).success;
  if (!valid) throw new BadRequestError("Invalid page cursor.");
  return { sort: page.sort, dir: page.dir, limit: page.limit, cursor: { value, id } };
}

export interface ReportRouteArgs {
  db: Database;
  viewer: Viewer;
  prefs: ViewerPrefs;
  query: ReportQuery;
  params: URLSearchParams;
}

/** What a report route asks the permission matrix; the Reports page by default. */
export interface RoutePermission {
  action: Action;
  resource?: (access: WorkspaceContext) => Resource;
}

const REPORTS_PAGE: RoutePermission = {
  action: "page.view",
  resource: () => ({ kind: "page", page: "reports" }),
};

/** The dashboard's Me tab: the viewer's own time. */
export const OWN_TIME: RoutePermission = {
  action: "entry.read",
  resource: (access) => ({ kind: "entry", userId: access.user.id, projectId: null }),
};

/** The dashboard's Team tab. */
export const TEAM_TIME: RoutePermission = { action: "report.readTeam" };

/**
 * What every report route does first: the workspace access check, the
 * permission, the viewer, their preferences and the query from the URL (an invalid query
 * falls back to the defaults, so a stale link still opens).
 */
export async function reportRoute<T>(
  workspaceSlug: string,
  request: Request,
  handler: (args: ReportRouteArgs) => Promise<T>,
  permission: RoutePermission = REPORTS_PAGE,
): Promise<Response> {
  try {
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(
      access,
      permission.action,
      permission.resource?.(access) ?? { kind: "none" },
    );
    const params = new URL(request.url).searchParams;
    const body = await handler({
      db: getDb(),
      viewer,
      prefs: resolveViewerPrefs(access.user, access.settings),
      query: parseReportQuery(params),
      params,
    });
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "reports");
  }
}
