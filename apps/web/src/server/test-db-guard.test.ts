import { describe, expect, it } from "vitest";

import { assertSafeTestDatabaseUrl } from "../../test/safe-test-db";

describe("assertSafeTestDatabaseUrl", () => {
  it("accepts local databases", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgres://timekeep:timekeep@localhost:5432/timekeep_test", {}),
    ).not.toThrow();
    expect(() => assertSafeTestDatabaseUrl("postgres://u:p@127.0.0.1:5432/t", {})).not.toThrow();
  });

  it("refuses remote databases, because the tests truncate every table", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://timekeep_app.ref:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
        {},
      ),
    ).toThrow(/truncate/i);
    expect(() => assertSafeTestDatabaseUrl("postgres://u:p@db.example.com:5432/x", {})).toThrow();
  });

  it("allows a remote throwaway database only with an explicit override", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgres://u:p@ci-db.internal:5432/x", {
        ALLOW_REMOTE_TEST_DATABASE: "true",
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeTestDatabaseUrl("postgres://u:p@aws-0-x.pooler.supabase.com:6543/postgres", {
        ALLOW_REMOTE_TEST_DATABASE: "true",
      }),
    ).toThrow(/Supabase/);
  });
});
