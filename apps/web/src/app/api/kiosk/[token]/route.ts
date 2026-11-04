import { getDb } from "@timekeep/db";

import { kioskErrorResponse, kioskJson, kioskScreen, resolveKiosk } from "@/server/kiosk/runtime";

/**
 * The kiosk screen's data: its name, logo and allowed people. Authorized by
 * the kiosk token alone (decision 15); no session is read or set.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/kiosk/[token]">) {
  try {
    const { token } = await ctx.params;
    const db = getDb();
    return kioskJson(await kioskScreen(db, await resolveKiosk(db, token)));
  } catch (error) {
    return kioskErrorResponse(error);
  }
}
