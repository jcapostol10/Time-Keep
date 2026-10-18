import { describe, expect, it } from "vitest";

import { cleanupTarget, isLocalDatabaseUrl } from "./local-db-guard";

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

describe("cleanupTarget", () => {
  it("is the URL cleanup actually connects to: the session URL when set", () => {
    expect(
      cleanupTarget({
        DATABASE_URL: "postgres://u:p@localhost:5432/x",
        DATABASE_URL_SESSION: "postgresql://a.b:pw@aws-0-x.pooler.supabase.com:5432/postgres",
      }),
    ).toBe("postgresql://a.b:pw@aws-0-x.pooler.supabase.com:5432/postgres");
    expect(cleanupTarget({ DATABASE_URL: "postgres://u:p@localhost:5432/x" })).toBe(
      "postgres://u:p@localhost:5432/x",
    );
  });

  it("is not local when the session URL is remote, even if DATABASE_URL is local", () => {
    const env = {
      DATABASE_URL: "postgres://u:p@localhost:5432/x",
      DATABASE_URL_SESSION: "postgresql://a.b:pw@aws-0-x.pooler.supabase.com:5432/postgres",
    };
    expect(isLocalDatabaseUrl(cleanupTarget(env))).toBe(false);
  });
});
