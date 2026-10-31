import { getDb } from "@timekeep/db";

import { testHookAuthorized } from "@/server/cron-auth";
import { e2eWorkspaceId, runDailyJobs } from "@/server/daily-jobs";
import { env } from "@/server/env";
import { drainAll } from "@/server/outbox";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * e2e only: the daily job for one workspace, at an optional `now`, then the
 * outbox. 404 in production, on a non-capturing deployment, or without the
 * e2e secret.
 */
export async function GET(request: Request) {
  if (!testHookAuthorized(env(), request.headers.get("x-e2e-secret"))) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const nowParam = url.searchParams.get("now");
  const now = nowParam ? new Date(nowParam) : new Date();
  if (Number.isNaN(now.getTime())) {
    return Response.json({ error: "Bad now" }, { status: 400, headers: NO_STORE });
  }
  const db = getDb();
  // Only an e2e tenant: a customer's workspace is the same 404 as none.
  const workspaceId = await e2eWorkspaceId(db, slug);
  if (!workspaceId)
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const jobs = await runDailyJobs(db, { now, workspaceIds: [workspaceId] });
  // The jobs run at `now`; the mail they enqueued is due from the real clock.
  const mail = await drainAll(db);
  return Response.json({ ...jobs, ...mail }, { headers: NO_STORE });
}
