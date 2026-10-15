import { sslOptionsFor } from "@timekeep/db/client";
import { describe, expect, it } from "vitest";

describe("sslOptionsFor", () => {
  it("verifies Supabase poolers against Supabase's root CA", () => {
    const ssl = sslOptionsFor(
      "postgresql://timekeep_app.ref:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    );
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    expect(ssl && typeof ssl === "object" && String(ssl.ca)).toContain("BEGIN CERTIFICATE");
  });

  it("also covers direct Supabase database hosts", () => {
    expect(sslOptionsFor("postgresql://postgres:pw@db.ref.supabase.co:5432/postgres")).toMatchObject({
      rejectUnauthorized: true,
    });
  });

  it("leaves local and other databases unchanged", () => {
    expect(sslOptionsFor("postgres://timekeep:timekeep@localhost:5432/timekeep")).toBeUndefined();
    expect(sslOptionsFor("postgres://u:p@db.example.com:5432/x")).toBeUndefined();
  });
});
