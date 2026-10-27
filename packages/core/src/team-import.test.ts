import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv-parse";
import { MAX_BULK_INVITES, parseEmailList, planUserImport } from "./team-import";

describe("parseEmailList", () => {
  it("splits on commas, spaces, semicolons and new lines, lowercases and dedupes", () => {
    expect(parseEmailList("Ana@X.co, bob@x.co;\nana@x.co  carl@x.co\nnot-an-email")).toEqual({
      emails: ["ana@x.co", "bob@x.co", "carl@x.co"],
      invalid: ["not-an-email"],
      error: null,
    });
  });

  it("refuses more than the bulk limit at once", () => {
    const text = Array.from({ length: MAX_BULK_INVITES + 1 }, (_, i) => `p${i}@x.co`).join("\n");
    expect(parseEmailList(text).error).toMatch(/100/);
  });
});

describe("planUserImport", () => {
  const ctx = {
    existingEmails: new Set(["member@x.co"]),
    pendingEmails: new Set(["pending@x.co"]),
    groupNames: new Map([["design", "g-design"]]),
  };

  it("plans each row with its status, role and groups", () => {
    const rows = parseCsv(
      [
        "Email,Role,Groups",
        "new@x.co,,Design;Ops",
        "Admin@X.co,Admin,",
        "boss@x.co,owner,",
        "who@x.co,superuser,",
        "nope,member,",
        "member@x.co,member,",
        "pending@x.co,manager,",
        "NEW@x.co,member,",
      ].join("\n"),
    );
    const plan = planUserImport(rows, ctx);
    expect(plan.error).toBeNull();
    expect(plan.rows.map((r) => [r.line, r.email, r.status, r.role])).toEqual([
      [2, "new@x.co", "ok", "member"],
      [3, "admin@x.co", "ok", "admin"],
      [4, "boss@x.co", "owner-role", "member"],
      [5, "who@x.co", "unknown-role", "member"],
      [6, "nope", "invalid-email", "member"],
      [7, "member@x.co", "member", "member"],
      [8, "pending@x.co", "invited", "manager"],
      [9, "new@x.co", "duplicate", "member"],
    ]);
    expect(plan.rows[0]?.groups).toEqual([
      { name: "Design", id: "g-design" },
      { name: "Ops", id: null },
    ]);
  });

  it("needs an email column and at most 500 rows", () => {
    expect(planUserImport(parseCsv("name,role\nAna,member\n"), ctx).error).toMatch(/email/i);
    const many = ["email", ...Array.from({ length: 501 }, (_, i) => `p${i}@x.co`)].join("\n");
    expect(planUserImport(parseCsv(many), ctx).error).toMatch(/500/);
  });
});
