import { parseReportQuery, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listExpenses } from "@/server/expenses";
import { TimeEntryError } from "@/server/time-entries";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/**
 * The Expenses page's list (Phase 6c): the report query from the URL plus
 * `cursor` and `limit`, within the viewer's scope, newest first.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/expenses">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "expense.read", {
      kind: "entry",
      userId: access.user.id,
      projectId: null,
    });
    const params = new URL(request.url).searchParams;
    const limitRaw = params.get("limit");
    const limit = limitRaw === null ? undefined : Number(limitRaw);
    if (limit !== undefined && !Number.isInteger(limit))
      throw new BadRequestError("Invalid limit.");
    const page = await listExpenses(
      getDb(),
      viewer,
      parseReportQuery(params),
      resolveViewerPrefs(access.user, access.settings),
      { cursor: params.get("cursor") ?? undefined, limit },
    ).catch((error: unknown) => {
      if (error instanceof TimeEntryError && error.code === "INVALID") {
        throw new BadRequestError(error.message);
      }
      throw error;
    });
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "expenses");
  }
}
