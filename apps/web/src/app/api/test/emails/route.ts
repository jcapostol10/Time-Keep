import { getDb } from "@timekeep/db";
import { isE2eEmail } from "@timekeep/db/e2e-tenant";

import { env } from "@/server/env";
import { listCapturedEmails, testEndpointAuthorized } from "@/server/mail-capture";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Preview-only: captured outgoing email for the e2e suite. 404 unless mail
 * capture is on, the deployment is not production, and `x-e2e-secret`
 * matches E2E_SECRET.
 */
export async function GET(request: Request) {
  const e = env();
  if (!testEndpointAuthorized(e, request.headers.get("x-e2e-secret"))) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const url = new URL(request.url);
  const to = url.searchParams.get("to");
  // Only e2e mailboxes are ever readable here.
  if (!to || !isE2eEmail(to)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const messages = await listCapturedEmails(getDb(), {
    to,
    subject: url.searchParams.get("subject") ?? undefined,
  });
  return Response.json({ messages }, { headers: NO_STORE });
}
