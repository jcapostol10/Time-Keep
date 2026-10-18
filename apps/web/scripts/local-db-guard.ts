/** True only for a database on this machine. Used to keep local cleanup local. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The database `pnpm db:e2e-cleanup` will connect to: it prefers
 * DATABASE_URL_SESSION, so the guard must check that, not DATABASE_URL.
 */
export function cleanupTarget(env: Record<string, string | undefined>): string | undefined {
  return env.DATABASE_URL_SESSION ?? env.DATABASE_URL;
}
