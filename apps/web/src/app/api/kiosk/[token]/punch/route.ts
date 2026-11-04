import { kioskPunchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { kioskErrorResponse, kioskJson, punch, resolveKiosk } from "@/server/kiosk/runtime";

/** Reads `{ ticket, action }` as JSON, or as multipart with the clock-in `photo`. */
async function readPunch(request: Request) {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const photo = form.get("photo");
    return {
      input: { ticket: form.get("ticket"), action: form.get("action") },
      photo: photo instanceof File ? new Uint8Array(await photo.arrayBuffer()) : null,
    };
  }
  return { input: await request.json().catch(() => null), photo: null };
}

/** Clock in, start or end a break, or clock out, at the server's time (decision 17). */
export async function POST(request: Request, ctx: RouteContext<"/api/kiosk/[token]/punch">) {
  try {
    const { token } = await ctx.params;
    const db = getDb();
    const k = await resolveKiosk(db, token);
    const { input, photo } = await readPunch(request);
    const parsed = kioskPunchSchema.safeParse(input);
    if (!parsed.success) return kioskJson({ error: "Pick what to do." }, 400);
    return kioskJson(await punch(db, k, parsed.data, photo));
  } catch (error) {
    return kioskErrorResponse(error);
  }
}
