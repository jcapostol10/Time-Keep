import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listExpenseCategories } from "@/server/expense-categories";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The workspace's expense categories (Phase 6c); `?archived=1` includes archived ones. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/expenses/categories">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "expense.read", {
      kind: "entry",
      userId: access.user.id,
      projectId: null,
    });
    const archived = new URL(request.url).searchParams.get("archived") === "1";
    const categories = await listExpenseCategories(getDb(), viewer, { includeArchived: archived });
    return Response.json(categories, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "expenses");
  }
}
