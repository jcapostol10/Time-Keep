import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { getInvoiceSettings } from "@/server/invoices/settings";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** Numbering and branding (Phase 6d), with the next number's preview; owners and admins. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/invoices/settings">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "invoice.manage");
    const settings = await getInvoiceSettings(getDb(), viewer);
    return Response.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "invoices");
  }
}
