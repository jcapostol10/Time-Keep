import { runMigrations } from "@timekeep/db/migrate";

/** Migrate the test database once before the suite. Requires TEST_DATABASE_URL. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start `docker compose up` and copy .env.example to .env.",
    );
  }
  await runMigrations(url);
}
