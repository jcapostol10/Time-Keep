import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listRecurring } from "@/server/invoices/recurring";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The recurring invoice templates (Phase 6d); owners and admins. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/invoices/recurring">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "invoice.manage");
    const templates = await listRecurring(getDb(), viewer);
    return Response.json(templates, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "invoices");
  }
}
