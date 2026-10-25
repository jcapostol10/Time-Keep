import "server-only";

import {
  parseReportQuery,
  type ReportQuery,
  resolveViewerPrefs,
  type ViewerPrefs,
} from "@timekeep/core";
import { type Database, getDb } from "@timekeep/db";

import type { Viewer } from "./catalog/viewer";
import { accessErrorResponse, requireWorkspaceAccess } from "./workspace-access";

export interface ReportRouteArgs {
  db: Database;
  viewer: Viewer;
  prefs: ViewerPrefs;
  query: ReportQuery;
  params: URLSearchParams;
}

/**
 * What every report route does first: the workspace access check, the
 * viewer, their preferences and the query from the URL (an invalid query
 * falls back to the defaults, so a stale link still opens).
 */
export async function reportRoute<T>(
  workspaceSlug: string,
  request: Request,
  handler: (args: ReportRouteArgs) => Promise<T>,
): Promise<Response> {
  try {
    const access = await requireWorkspaceAccess(workspaceSlug);
    const params = new URL(request.url).searchParams;
    const body = await handler({
      db: getDb(),
      viewer: { workspaceId: access.workspace.id, userId: access.user.id, role: access.role },
      prefs: resolveViewerPrefs(access.user, access.settings),
      query: parseReportQuery(params),
      params,
    });
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      Response.json({ error: "Something went wrong." }, { status: 500 })
    );
  }
}
