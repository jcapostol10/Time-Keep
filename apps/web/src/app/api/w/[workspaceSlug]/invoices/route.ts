import { COMPUTED_INVOICE_STATUSES, type ComputedInvoiceStatus } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listInvoices } from "@/server/invoices/invoices";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

const STATUSES = new Set<string>(["all", ...COMPUTED_INVOICE_STATUSES]);

/** The Invoices page's list (Phase 6d): `status`, `clientId`, `cursor`, `limit`; owners and admins. */
export async function GET(request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/invoices">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "invoice.manage");
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "all";
    if (!STATUSES.has(status)) throw new BadRequestError("Invalid status.");
    const limitRaw = params.get("limit");
    const limit = limitRaw === null ? undefined : Number(limitRaw);
    if (limit !== undefined && !Number.isInteger(limit))
      throw new BadRequestError("Invalid limit.");
    const page = await listInvoices(getDb(), viewer, {
      status: status as ComputedInvoiceStatus | "all",
      clientId: params.get("clientId") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    });
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "invoices");
  }
}
