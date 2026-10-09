import { describe, expect, it } from "vitest";

import { assignableRoles, hasMinRole, isRole, ROLES, roleRank } from "./roles";

describe("roles", () => {
  it("ranks owner > admin > manager > member", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("manager"));
    expect(roleRank("manager")).toBeGreaterThan(roleRank("member"));
  });

  it("hasMinRole is inclusive", () => {
    expect(hasMinRole("member", "member")).toBe(true);
    expect(hasMinRole("admin", "manager")).toBe(true);
    expect(hasMinRole("manager", "admin")).toBe(false);
    expect(hasMinRole("owner", "owner")).toBe(true);
    expect(hasMinRole("admin", "owner")).toBe(false);
  });

  it("isRole only accepts known lowercase roles", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("OWNER")).toBe(false);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("owner is never assignable; managers and members assign nothing", () => {
    expect(assignableRoles("owner")).not.toContain("owner");
    expect(assignableRoles("admin")).toEqual(["admin", "manager", "member"]);
    expect(assignableRoles("manager")).toEqual([]);
    expect(assignableRoles("member")).toEqual([]);
  });
});
