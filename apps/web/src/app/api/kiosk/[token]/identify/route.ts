import { kioskIdentifySchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { identify, kioskErrorResponse, kioskJson, resolveKiosk } from "@/server/kiosk/runtime";

/** A PIN or a QR code proves who is at the kiosk; the answer carries their punch ticket. */
export async function POST(request: Request, ctx: RouteContext<"/api/kiosk/[token]/identify">) {
  try {
    const { token } = await ctx.params;
    const db = getDb();
    const k = await resolveKiosk(db, token);
    const parsed = kioskIdentifySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return kioskJson({ error: "Enter your PIN or scan your code." }, 400);
    return kioskJson(await identify(db, k, parsed.data));
  } catch (error) {
    return kioskErrorResponse(error);
  }
}
