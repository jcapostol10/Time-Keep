import { isoInstantSchema, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { listEntriesPage } from "@/server/time-entries";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

const NO_STORE = { "Cache-Control": "no-store" };

/** One week of the caller's entries; `?before=<ISO instant>` pages back in time. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-entries">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);

    const beforeRaw = new URL(request.url).searchParams.get("before");
    let before: Date | undefined;
    if (beforeRaw) {
      const parsed = isoInstantSchema.safeParse(beforeRaw);
      if (!parsed.success) return Response.json({ error: "Invalid cursor" }, { status: 400 });
      before = parsed.data;
    }

    const viewer = resolveViewerPrefs(access.user, access.settings);
    const page = await listEntriesPage(
      getDb(),
      { workspaceId: access.workspace.id, userId: access.user.id, role: access.role },
      { before, tz: viewer.timezone, weekStart: viewer.weekStart },
    );
    return Response.json(page, { headers: NO_STORE });
  } catch (error) {
    return routeErrorResponse(error, "time-entries");
  }
}
