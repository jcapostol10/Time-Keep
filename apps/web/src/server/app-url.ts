/**
 * The public URL of this deployment. Configured URLs win (production and
 * local dev); on Vercel previews nothing is configured, so the deployment's
 * own URL is used and auth callbacks and email links point at it.
 */
export interface AppUrlEnv {
  BETTER_AUTH_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
}

const LOCAL_URL = "http://localhost:3000";

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v.replace(/\/+$/, "") : undefined;
}

export function resolveAppUrl(e: AppUrlEnv): string {
  const configured = clean(e.BETTER_AUTH_URL) ?? clean(e.NEXT_PUBLIC_APP_URL);
  if (configured) return configured;
  const vercelUrl = clean(e.VERCEL_URL);
  if (e.VERCEL_ENV && vercelUrl) return `https://${vercelUrl}`;
  return LOCAL_URL;
}

/** Origins Better Auth accepts: the app URL plus the branch alias on Vercel. */
export function trustedOrigins(e: AppUrlEnv): string[] {
  const origins = [resolveAppUrl(e)];
  const branch = clean(e.VERCEL_BRANCH_URL);
  if (branch) origins.push(`https://${branch}`);
  return [...new Set(origins)];
}
