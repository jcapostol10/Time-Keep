import { getDb } from "@timekeep/db";

import { cronAuthorized } from "@/server/cron-auth";
import { env } from "@/server/env";
import { drainOutbox } from "@/server/outbox";

const NO_STORE = { "Cache-Control": "no-store" };

/** Sends the due email; the local worker calls it every minute. 404 without CRON_SECRET. */
export async function GET(request: Request) {
  if (!cronAuthorized(request, env().CRON_SECRET)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const result = await drainOutbox(getDb(), { limit: 200 });
  return Response.json(result, { headers: NO_STORE });
}
