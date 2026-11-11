import { randomUUID } from "node:crypto";

import { eq, workspace } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../../test/db";
import { type ScheduleCast, setUpScheduleCast } from "../../test/schedule-fixtures";
import type { AuthSession } from "./auth";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
});

const session = vi.hoisted(() => ({ current: null as AuthSession | null }));
vi.mock("./session", () => ({ getSession: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (original) => ({
  ...(await original<object>()),
  after: () => undefined,
}));

const { createAssignmentAction, publishScheduleAction } = await import("./actions/schedule");
const { GET: teamRoute } = await import("../app/api/w/[workspaceSlug]/schedule/route");
const { GET: mineRoute } = await import("../app/api/w/[workspaceSlug]/schedule/mine/route");

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: ScheduleCast;
let slug: string;
beforeEach(async () => {
  cast = await setUpScheduleCast(db);
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, cast.wsId));
  slug = ws!.slug;
});

function signIn(who: keyof ScheduleCast["ids"]) {
  session.current = {
    user: { id: cast.ids[who] },
    session: { id: randomUUID(), userId: cast.ids[who] },
  } as unknown as AuthSession;
}

const params = (workspaceSlug: string) => ({ params: Promise.resolve({ workspaceSlug }) });
const get = (path: string) => new Request(`http://localhost/api/w/${slug}/${path}`);

describe("schedule actions", () => {
  it("a member is refused, a manager outside their scope is not found", async () => {
    signIn("bob");
    const asMember = await createAssignmentAction(slug, cast.input("bob", cast.projects.website));
    expect(asMember).toEqual({ ok: false, error: "You don't have permission to do that." });
    signIn("max");
    const outside = await createAssignmentAction(slug, cast.input("ann", cast.projects.mobile));
    expect(outside).toEqual({ ok: false, error: "Not found" });
    const inside = await createAssignmentAction(slug, cast.input("bob", cast.projects.mobile));
    expect(inside.ok).toBe(true);
    expect((await publishScheduleAction(slug)).ok).toBe(true);
  });

  it("a validation error names its field", async () => {
    signIn("olga");
    const bad = await createAssignmentAction(slug, {
      ...cast.input("bob", cast.projects.website),
      minutesPerDay: null,
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.fieldErrors?.minutesPerDay).toEqual(["Enter the hours per day."]);
    const service = await createAssignmentAction(slug, cast.input("max", cast.projects.secret));
    expect(!service.ok && service.fieldErrors?.projectId).toEqual([
      "Add Max Manager to the project first.",
    ]);
  });
});

describe("schedule routes", () => {
  it("the team route is 403 for a member and 400 for more than 13 weeks", async () => {
    signIn("bob");
    const member = await teamRoute(get("schedule?from=2026-11-16&to=2026-11-22"), params(slug));
    expect(member.status).toBe(403);
    signIn("olga");
    const long = await teamRoute(get("schedule?from=2026-11-01&to=2027-02-28"), params(slug));
    expect(long.status).toBe(400);
    const ok = await teamRoute(get("schedule?from=2026-11-16&to=2026-11-22"), params(slug));
    expect(ok.status).toBe(200);
    expect((await ok.json()).plan).toBe("working");
  });

  it("the mine route is everyone's own published plan", async () => {
    signIn("bob");
    const res = await mineRoute(get("schedule/mine?from=2026-11-16&to=2026-11-22"), params(slug));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect([body.plan, body.people.map((p: { userId: string }) => p.userId)]).toEqual([
      "published",
      [cast.ids.bob],
    ]);
  });
});
