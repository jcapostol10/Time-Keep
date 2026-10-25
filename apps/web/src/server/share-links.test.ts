import { createHash } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { and, eq, membership, reportShareLink } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import type { Viewer } from "./catalog/viewer";
import {
  claimShareExport,
  createShareLink,
  listShareLinks,
  recordShareOpen,
  resolveShareLink,
  revokeShareLink,
} from "./share-links";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const QUERY: ReportQuery = { ...DEFAULT_REPORT_QUERY, preset: "this-week" };
const NOW = new Date("2026-03-11T04:00:00.000Z");
const day = 24 * 3_600_000;

let alice: Viewer; // owner
let bob: Viewer; // member
let carol: Viewer; // member

describe("share links", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const a = await createTestUser(db, "Alice A");
    const b = await createTestUser(db, "Bob B");
    const c = await createTestUser(db, "Carol C");
    const ws = await createTestWorkspace(db, "Workspace A", a.id);
    await addMember(db, ws.id, b.id, "member");
    await addMember(db, ws.id, c.id, "member");
    alice = { workspaceId: ws.id, userId: a.id, role: "owner" };
    bob = { workspaceId: ws.id, userId: b.id, role: "member" };
    carol = { workspaceId: ws.id, userId: c.id, role: "member" };
  });

  it("stores only the token's hash and resolves the token to the stored report", async () => {
    const created = await createShareLink(
      db,
      alice,
      { kind: "summary", query: QUERY, title: "This week" },
      PREFS,
      NOW,
    );
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.path).toBe(`/share/${created.token}`);
    const [row] = await db.select().from(reportShareLink).where(eq(reportShareLink.id, created.id));
    expect(row!.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(created.token);

    const resolved = await resolveShareLink(db, created.token, NOW);
    expect(resolved).toMatchObject({
      kind: "summary",
      title: "This week",
      viewer: { workspaceId: alice.workspaceId, userId: alice.userId, role: "owner" },
      prefs: PREFS,
      workspaceName: "Workspace A",
    });
    expect(resolved!.query.preset).toBe("this-week");

    await recordShareOpen(db, created.id, NOW);
    await recordShareOpen(db, created.id, NOW);
    const [opened] = await db
      .select()
      .from(reportShareLink)
      .where(eq(reportShareLink.id, created.id));
    expect(opened).toMatchObject({ openCount: 2, lastOpenedAt: NOW });
  });

  it("lets a link export once per ten seconds, so a public URL cannot keep Chromium busy", async () => {
    const created = await createShareLink(
      db,
      alice,
      { kind: "summary", query: QUERY, title: "Throttled" },
      PREFS,
      NOW,
    );
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    expect(await claimShareExport(db, created.id, at(0))).toBe(true);
    expect(await claimShareExport(db, created.id, at(1_000))).toBe(false);
    expect(await claimShareExport(db, created.id, at(9_999))).toBe(false);
    expect(await claimShareExport(db, created.id, at(10_000))).toBe(true);
    // Two requests at the same moment: one wins.
    const both = await Promise.all([
      claimShareExport(db, created.id, at(30_000)),
      claimShareExport(db, created.id, at(30_000)),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it("resolves nothing for a wrong, expired or revoked token, or a creator who left", async () => {
    expect(await resolveShareLink(db, "not-a-token", NOW)).toBeNull();

    const expiring = await createShareLink(
      db,
      alice,
      { kind: "summary", query: QUERY, title: "t", expiresInDays: 7 },
      PREFS,
      NOW,
    );
    expect(
      await resolveShareLink(db, expiring.token, new Date(NOW.getTime() + 6 * day)),
    ).not.toBeNull();
    expect(
      await resolveShareLink(db, expiring.token, new Date(NOW.getTime() + 8 * day)),
    ).toBeNull();

    const revoked = await createShareLink(
      db,
      alice,
      { kind: "summary", query: QUERY, title: "t" },
      PREFS,
      NOW,
    );
    await revokeShareLink(db, alice, revoked.id, NOW);
    expect(await resolveShareLink(db, revoked.token, NOW)).toBeNull();

    const bobs = await createShareLink(
      db,
      bob,
      { kind: "detailed", query: QUERY, title: "t" },
      PREFS,
      NOW,
    );
    await db
      .update(membership)
      .set({ status: "DEACTIVATED" })
      .where(and(eq(membership.workspaceId, bob.workspaceId), eq(membership.userId, bob.userId)));
    expect(await resolveShareLink(db, bobs.token, NOW)).toBeNull();
  });

  it("keeps a member's link to their own time, whatever the query asked", async () => {
    const created = await createShareLink(
      db,
      bob,
      { kind: "summary", query: { ...QUERY, userIds: [alice.userId] }, title: "t" },
      PREFS,
      NOW,
    );
    const resolved = await resolveShareLink(db, created.token, NOW);
    expect(resolved!.query.userIds).toEqual([bob.userId]);
    expect(resolved!.viewer.role).toBe("member");
  });

  it("lists the workspace's links for team readers and one's own for members; revoking follows suit", async () => {
    const mine = await createShareLink(
      db,
      alice,
      { kind: "summary", query: QUERY, title: "Alice's" },
      PREFS,
      NOW,
    );
    const bobs = await createShareLink(
      db,
      bob,
      { kind: "weekly", query: QUERY, title: "Bob's" },
      PREFS,
      new Date(NOW.getTime() + 1000),
    );
    expect((await listShareLinks(db, alice, NOW)).map((l) => l.title)).toEqual([
      "Bob's",
      "Alice's",
    ]);
    expect((await listShareLinks(db, bob, NOW)).map((l) => [l.title, l.createdBy])).toEqual([
      ["Bob's", "Bob B"],
    ]);
    expect(await listShareLinks(db, carol, NOW)).toEqual([]);

    await expect(revokeShareLink(db, carol, bobs.id, NOW)).rejects.toThrow(/not found/i);
    await revokeShareLink(db, alice, bobs.id, NOW);
    expect((await listShareLinks(db, bob, NOW))[0]).toMatchObject({ status: "revoked" });
    await expect(revokeShareLink(db, bob, mine.id, NOW)).rejects.toThrow(/not found/i);
  });
});
