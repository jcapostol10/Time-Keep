import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, type AuthSession } from "./auth";

/**
 * Current session from the request cookies, or null. Pass `fresh: true` to
 * bypass the short-lived session cookie cache (e.g. right after the active
 * workspace changed).
 */
export async function getSession(options: { fresh?: boolean } = {}): Promise<AuthSession | null> {
  const auth = getAuth();
  return auth.api.getSession({
    headers: await headers(),
    query: options.fresh ? { disableCookieCache: true } : undefined,
  });
}

/** Current session, or redirect to sign-in (remembering where the user was going). */
export async function requireSession(returnTo?: string): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    const target = returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : "/sign-in";
    redirect(target);
  }
  return session;
}
