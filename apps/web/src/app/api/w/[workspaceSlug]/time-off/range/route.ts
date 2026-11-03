import { getDb } from "@timekeep/db";
import { z } from "zod";

import { authorize } from "@/server/authz";
import { timeOffRange } from "@/server/time-off/requests";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/** At most a year and a bit: the timesheet and calendar ask for a week or a month. */
const querySchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from <= q.to && Number(q.to.slice(0, 4)) - Number(q.from.slice(0, 4)) <= 1);

/** Approved time off per day and the holidays of `?userId=` (default: the caller), `?from=&to=`. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/range">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const params = new URL(request.url).searchParams;
    const userId = params.get("userId") || access.user.id;
    const viewer = await authorize(access, "timeOff.view", { kind: "person", userId });
    const parsed = querySchema.safeParse({ from: params.get("from"), to: params.get("to") });
    if (!parsed.success) throw new BadRequestError("Pick a range");
    const range = await timeOffRange(getDb(), viewer, { userId, ...parsed.data });
    return Response.json(range, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-off range");
  }
}
