import type { BrowserContext } from "@playwright/test";

/**
 * The names of a context's cookies, never their values. A failed assertion's
 * diff lands in the Playwright report, which is public on a preview run, and
 * there the cookies carry Vercel's protection bypass (`_vercel_jwt`). Lint keeps
 * `cookies()` out of the specs; this is the one reader.
 */
export async function cookieNames(context: BrowserContext): Promise<string[]> {
  // eslint-disable-next-line no-restricted-syntax -- the values never leave this function
  const cookies = await context.cookies();
  return cookies.map((cookie) => cookie.name);
}

/** The app's own cookies: Vercel's deployment-protection cookies are dropped. */
export async function appCookieNames(context: BrowserContext): Promise<string[]> {
  const names = await cookieNames(context);
  return names.filter((name) => !name.startsWith("_vercel") && !name.startsWith("vercel-"));
}
