import { invoiceImportSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { previewImport } from "@/server/invoices/import";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/** What "Import time and expenses" would take, from the dialog's query string (Phase 6d). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/invoices/[invoiceId]/import-preview">,
) {
  try {
    const { workspaceSlug, invoiceId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "invoice.manage");
    const params = new URL(request.url).searchParams;
    const expenses = params.get("expenses");
    const parsed = invoiceImportSchema.safeParse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      projectIds: params.getAll("projectIds"),
      groupBy: params.get("groupBy") ?? undefined,
      expenses: expenses === null ? undefined : expenses === "1" || expenses === "true",
    });
    if (!parsed.success) throw new BadRequestError("Invalid import range.");
    const preview = await previewImport(getDb(), viewer, invoiceId, parsed.data);
    return Response.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "invoices");
  }
}
