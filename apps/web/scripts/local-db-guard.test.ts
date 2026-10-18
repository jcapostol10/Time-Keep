import { describe, expect, it } from "vitest";

import { isLocalDatabaseUrl } from "./local-db-guard";

describe("isLocalDatabaseUrl", () => {
  it("accepts local hosts", () => {
    expect(isLocalDatabaseUrl("postgres://timekeep:timekeep@localhost:5432/timekeep")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@127.0.0.1:5432/x")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@[::1]:5432/x")).toBe(true);
  });

  it("rejects Supabase and any other remote host", () => {
    expect(
      isLocalDatabaseUrl(
        "postgresql://timekeep_app.ref:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe(false);
    expect(isLocalDatabaseUrl("postgres://u:p@db.example.com:5432/x")).toBe(false);
  });

  it("rejects missing or malformed URLs", () => {
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
  });
});
