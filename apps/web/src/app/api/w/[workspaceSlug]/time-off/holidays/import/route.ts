import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { previewHolidayImport } from "@/server/time-off/holidays";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/** The reviewed list: `?country=&region=&year=&optional=1`. Nothing is written. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/holidays/import">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "timeOff.manage", { kind: "none" });
    const params = new URL(request.url).searchParams;
    const country = params.get("country") ?? "";
    const region = params.get("region") || null;
    const year = Number(params.get("year"));
    if (!/^[A-Z]{2}$/.test(country) || (region !== null && !/^[A-Za-z0-9-]{1,10}$/.test(region))) {
      throw new BadRequestError("Pick a country");
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestError("Pick a year");
    }
    const candidates = await previewHolidayImport(getDb(), viewer, {
      country,
      region,
      year,
      includeOptional: params.get("optional") === "1",
    });
    return Response.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "holiday import");
  }
}
