import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { getInvoice } from "@/server/invoices/invoices";
import { buildInvoicePdf } from "@/server/invoices/pdf";
import { getExport } from "@/server/storage";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/**
 * The invoice as PDF (Phase 6d): the file frozen on send, or a live render of
 * a draft; shown inline under its number. Owners and admins.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/invoices/[invoiceId]/pdf">,
) {
  try {
    const { workspaceSlug, invoiceId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "invoice.manage");
    const db = getDb();
    const invoice = await getInvoice(db, viewer, invoiceId);
    const body = invoice.hasPdf
      ? await getExport(`invoices/${access.workspace.id}/${invoiceId}.pdf`)
      : await buildInvoicePdf(db, viewer, invoiceId);
    const safe = invoice.number.replace(/[^\w.\- ]+/g, "_");
    return new Response(Buffer.from(body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safe}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "invoices");
  }
}
