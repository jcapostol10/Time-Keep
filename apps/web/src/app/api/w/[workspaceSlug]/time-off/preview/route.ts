import { timeOffRequestSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { previewTimeOff } from "@/server/time-off/requests";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";
import { CatalogError } from "@/server/catalog/errors";

/**
 * What a request would take and leave (`?policyId=&start=&end=&halfDay=1&hours=`);
 * a refusal the request would meet comes back as `{ error }` with 200, so the
 * dialog can show it while the person types.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/preview">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "timeOff.request", {
      kind: "person",
      userId: access.user.id,
    });
    const params = new URL(request.url).searchParams;
    const parsed = timeOffRequestSchema.safeParse({
      policyId: params.get("policyId"),
      start: params.get("start"),
      end: params.get("end"),
      halfDay: params.get("halfDay") === "1",
      hours: params.get("hours") ?? undefined,
    });
    if (!parsed.success) throw new BadRequestError("Pick a policy and dates");
    try {
      const preview = await previewTimeOff(getDb(), viewer, parsed.data);
      return Response.json({ preview }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof CatalogError) {
        return Response.json(
          { error: error.message },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      throw error;
    }
  } catch (error) {
    return routeErrorResponse(error, "time-off preview");
  }
}
