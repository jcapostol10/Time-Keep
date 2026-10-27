import { describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
});

const { getAuth } = await import("./auth");

const post = (path: string) =>
  getAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: "{}",
    }),
  );

/**
 * Team changes go through server/team.ts and the permission matrix. Better
 * Auth's own organization endpoints would let any admin (even a deactivated
 * one, whose session still works) change roles or remove people around it,
 * so only the routes the app calls over HTTP stay open.
 */
describe("Better Auth organization routes", () => {
  it.each([
    "/organization/update-member-role",
    "/organization/remove-member",
    "/organization/invite-member",
    "/organization/update",
    "/organization/delete",
    "/organization/leave",
  ])("refuses %s over HTTP", async (path) => {
    expect((await post(path)).status).toBe(404);
  });

  it.each(["/organization/accept-invitation", "/organization/set-active"])(
    "keeps %s, which the app calls",
    async (path) => {
      expect((await post(path)).status).not.toBe(404);
    },
  );
});

describe("Better Auth organization limits", () => {
  it("allows more invitations and members than a 500-row user import", () => {
    const plugin = getAuth().options.plugins?.find((p) => p.id === "organization") as
      | { options?: { invitationLimit?: unknown; membershipLimit?: unknown } }
      | undefined;
    // Better Auth defaults both to 100; seats arrive with plans in Phase 8.
    expect(Number(plugin?.options?.invitationLimit)).toBeGreaterThanOrEqual(1000);
    expect(Number(plugin?.options?.membershipLimit)).toBeGreaterThanOrEqual(1000);
  });
});
