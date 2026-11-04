import { getDb } from "@timekeep/db";

import { WorkspaceAccessError } from "@/server/access-error";
import { authorize } from "@/server/authz";
import { kioskPhotoUrl } from "@/server/kiosk/photos";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/**
 * An entry's clock-in photo: a redirect to a 5-minute presigned URL in the
 * private bucket, for those who manage kiosks; the same 404 for everyone else
 * as for an entry without one (ruling R6).
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/kiosk-photos/[entryId]">,
) {
  try {
    const { workspaceSlug, entryId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "kiosk.manage").catch(() => {
      throw new WorkspaceAccessError(404, "Not found");
    });
    const url = await kioskPhotoUrl(getDb(), viewer, entryId);
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error, "kiosk-photos");
  }
}
