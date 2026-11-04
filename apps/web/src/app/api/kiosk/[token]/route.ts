import { getDb } from "@timekeep/db";

import type { KioskScreenDTO } from "@/lib/kiosk-types";
import { kioskErrorResponse, kioskJson, kioskPeople, resolveKiosk } from "@/server/kiosk/runtime";

/**
 * The kiosk screen's data: its name, logo and allowed people. Authorized by
 * the kiosk token alone (decision 15); no session is read or set.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/kiosk/[token]">) {
  try {
    const { token } = await ctx.params;
    const db = getDb();
    const k = await resolveKiosk(db, token);
    const body: KioskScreenDTO = {
      name: k.name,
      workspaceName: k.workspaceName,
      logo: k.showLogo ? k.logo : null,
      sessionTimeoutSeconds: k.sessionTimeoutSeconds,
      photo: k.photo,
      people: await kioskPeople(db, k),
      now: new Date().toISOString(),
    };
    return kioskJson(body);
  } catch (error) {
    return kioskErrorResponse(error);
  }
}
