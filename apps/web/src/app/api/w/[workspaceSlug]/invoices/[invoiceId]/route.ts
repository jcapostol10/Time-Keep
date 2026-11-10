import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { getInvoice } from "@/server/invoices/invoices";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** One invoice with its lines and payments (Phase 6d); owners and admins. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/invoices/[invoiceId]">,
) {
  try {
    const { workspaceSlug, invoiceId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "invoice.manage");
    const invoice = await getInvoice(getDb(), viewer, invoiceId);
    return Response.json(invoice, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "invoices");
  }
}
