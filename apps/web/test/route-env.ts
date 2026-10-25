import { assertSafeTestDatabaseUrl } from "./safe-test-db";

/**
 * Route handler tests call the real handlers, which reach the database
 * through getDb() (DATABASE_URL). Point it at the test database before the
 * first call; call this from vi.hoisted so it runs before any import.
 */
export function routesUseTestDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  assertSafeTestDatabaseUrl(url);
  process.env.DATABASE_URL = url;
}

/** A route's second argument. */
export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}
