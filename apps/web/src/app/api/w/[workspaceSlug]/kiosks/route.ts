import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listKiosks } from "@/server/kiosk/kiosks";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The workspace's kiosks (owners and admins). Device URLs are never listed (ruling R1). */
export async function GET(_request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/kiosks">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "kiosk.manage", { kind: "none" });
    const kiosks = await listKiosks(getDb(), viewer);
    return Response.json({ kiosks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "kiosks");
  }
}
