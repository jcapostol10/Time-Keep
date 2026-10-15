/**
 * The integration tests truncate every table. Never let them run against a
 * shared database: only local hosts are accepted, and Supabase never, even
 * with the explicit override meant for throwaway remote test databases.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

export function assertSafeTestDatabaseUrl(
  url: string,
  env: Record<string, string | undefined> = process.env,
): void {
  const host = new URL(url).hostname;
  if (host.endsWith(".supabase.com") || host.endsWith(".supabase.co")) {
    throw new Error(
      `TEST_DATABASE_URL points at Supabase (${host}). The integration tests truncate every table; use the local Docker database.`,
    );
  }
  if (!LOCAL_HOSTS.has(host) && env.ALLOW_REMOTE_TEST_DATABASE !== "true") {
    throw new Error(
      `TEST_DATABASE_URL host "${host}" is not local. The integration tests truncate every table; set ALLOW_REMOTE_TEST_DATABASE=true only for a throwaway database.`,
    );
  }
}
