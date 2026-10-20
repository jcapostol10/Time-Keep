import { getDb } from "@timekeep/db";

import { listTemplates } from "@/server/timesheet";
import { accessErrorResponse, requireWorkspaceAccess } from "@/server/workspace-access";

/** The caller's timesheet templates in this workspace. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/timesheet-templates">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const templates = await listTemplates(getDb(), {
      workspaceId: access.workspace.id,
      userId: access.user.id,
      role: access.role,
    });
    return Response.json({ templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      Response.json({ error: "Something went wrong." }, { status: 500 })
    );
  }
}
