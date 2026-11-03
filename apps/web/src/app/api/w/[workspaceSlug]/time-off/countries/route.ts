import { countryForTimezone, listCountries, listRegions } from "@timekeep/core/holiday-import";

import type { HolidayCountriesDTO } from "@/lib/time-off-types";
import { authorize } from "@/server/authz";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** Countries, a country's regions (`?country=`), and the one suggested by the workspace timezone. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/countries">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    await authorize(access, "timeOff.manage", { kind: "none" });
    const suggested = countryForTimezone(access.settings.timezone ?? "UTC");
    const country = new URL(request.url).searchParams.get("country") ?? suggested;
    const body: HolidayCountriesDTO = {
      countries: listCountries(),
      regions: country && /^[A-Z]{2}$/.test(country) ? listRegions(country) : [],
      suggested,
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "holiday countries");
  }
}
