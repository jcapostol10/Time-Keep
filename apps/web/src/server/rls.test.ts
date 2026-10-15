import { sql } from "@timekeep/db";
import { afterAll, describe, expect, it } from "vitest";

import { connectTestDb } from "../../test/db";

const handle = connectTestDb();

/**
 * Supabase exposes `public` tables through its Data API. Every table must have
 * row-level security on (with no policies) so that API can read nothing; the
 * app connects as the table owner and is unaffected. New tables need
 * `.enableRLS()` in the Drizzle schema, and this test catches any that miss it.
 */
describe("row-level security", () => {
  afterAll(async () => handle.close());

  it("is enabled on every table in the public schema", async () => {
    const result = await handle.db.execute<{ relname: string }>(sql`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by c.relname
    `);
    expect(result.rows.map((r) => r.relname)).toEqual([]);
  });
});
