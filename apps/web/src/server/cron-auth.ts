import { timingSafeEqual } from "node:crypto";

import { captureEnabled, type CaptureEnv } from "./mail-capture";

const MIN_SECRET_LENGTH = 16;

function same(secret: string, provided: string): boolean {
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron (and the local worker) send `Authorization: Bearer <CRON_SECRET>`. */
export function cronAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return same(secret, header.slice("Bearer ".length));
}

/**
 * The e2e suite's hooks that run server jobs (the daily job for one
 * workspace): a capturing preview, or a server not on Vercel at all (local,
 * the nightly lane), with the e2e secret. Never production.
 */
export function testHookAuthorized(e: CaptureEnv, provided: string | null): boolean {
  if (e.VERCEL_ENV === "production") return false;
  if (e.VERCEL_ENV !== undefined && !captureEnabled(e)) return false;
  const secret = e.E2E_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH || !provided) return false;
  return same(secret, provided);
}
