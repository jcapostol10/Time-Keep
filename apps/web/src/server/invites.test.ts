import { randomUUID } from "node:crypto";

import { eq, invitation, invitationGroup, userGroupMember } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import type { Viewer } from "./catalog/viewer";
import { createGroup, listGroups } from "./groups";
import {
  commitUserImport,
  inviteMany,
  joinInvitedGroups,
  previewUserImport,
  type SendInvite,
} from "./invites";

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

/** Stands in for Better Auth + the invitation email: records a pending invitation. */
function sender(failFor: string[] = []): SendInvite & { sent: string[] } {
  const sent: string[] = [];
  const send = (async (email, role) => {
    if (failFor.includes(email)) throw new Error("SMTP refused the message");
    const id = randomUUID();
    await db.insert(invitation).values({
      id,
      workspaceId: wsId,
      email,
      role,
      status: "pending",
      inviterId: ids.olga!,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    sent.push(email);
    return { invitationId: id };
  }) as SendInvite & { sent: string[] };
  send.sent = sent;
  return send;
}

describe("invites", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const bob = await createTestUser(db, "Bob Member");
    const max = await createTestUser(db, "Max Manager");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, bob.id, "member");
    await addMember(db, ws.id, max.id, "manager");
    ids = { olga: olga.id, bob: bob.id, max: max.id, bobEmail: bob.email };
    await db.insert(invitation).values({
      id: randomUUID(),
      workspaceId: ws.id,
      email: "waiting@x.co",
      role: "member",
      status: "pending",
      inviterId: olga.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });

  it("invites many and reports each address in order", async () => {
    const owner = await viewer("olga");
    const design = await createGroup(db, owner, "Design");
    const send = sender(["bounce@x.co"]);
    const results = await inviteMany(
      db,
      owner,
      {
        emails: ["new1@x.co", ids.bobEmail!, "waiting@x.co", "nope", "bounce@x.co", "new2@x.co"],
        role: "manager",
        groupIds: [design.id],
      },
      send,
    );
    expect(results.map((r) => [r.email, r.result])).toEqual([
      ["new1@x.co", "invited"],
      [ids.bobEmail, "member"],
      ["waiting@x.co", "invited-already"],
      ["nope", "invalid"],
      ["bounce@x.co", "failed"],
      ["new2@x.co", "invited"],
    ]);
    expect(results[4]?.error).toMatch(/SMTP/);
    expect(send.sent).toEqual(["new1@x.co", "new2@x.co"]);
    const linked = await db.select().from(invitationGroup);
    expect(linked).toHaveLength(2);
  });

  it("refuses a manager", async () => {
    await expect(
      inviteMany(
        db,
        await viewer("max"),
        { emails: ["a@x.co"], role: "member", groupIds: [] },
        sender(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("puts an invitee in the invitation's groups when they accept", async () => {
    const owner = await viewer("olga");
    const design = await createGroup(db, owner, "Design");
    await inviteMany(
      db,
      owner,
      { emails: ["new@x.co"], role: "member", groupIds: [design.id] },
      sender(),
    );
    const [row] = await db.select().from(invitation).where(eq(invitation.email, "new@x.co"));
    const invitee = await createTestUser(db, "New Person");
    await joinInvitedGroups(db, row!.id, invitee.id);
    const groups = await db
      .select()
      .from(userGroupMember)
      .where(eq(userGroupMember.userId, invitee.id));
    expect(groups.map((g) => g.groupId)).toEqual([design.id]);
  });

  it("previews a user CSV and invites the good rows, creating missing groups", async () => {
    const owner = await viewer("olga");
    await createGroup(db, owner, "Design");
    const csv = [
      "email,role,groups",
      "ana@x.co,admin,Design;Ops",
      `${ids.bobEmail},member,`,
      "boss@x.co,owner,",
      "ben@x.co,,",
    ].join("\n");
    const preview = await previewUserImport(db, owner, csv);
    expect(preview.error).toBeNull();
    expect(preview.rows.map((r) => r.status)).toEqual(["ok", "member", "owner-role", "ok"]);

    const send = sender();
    const result = await commitUserImport(db, owner, csv, send);
    expect(result.invited).toBe(2);
    expect(send.sent).toEqual(["ana@x.co", "ben@x.co"]);
    expect((await listGroups(db, owner)).map((g) => g.name)).toEqual(["Design", "Ops"]);
    const anaInvite = await db.select().from(invitation).where(eq(invitation.email, "ana@x.co"));
    expect(anaInvite[0]?.role).toBe("admin");
  });

  it("refuses a file over 1 MB", async () => {
    const big = `email\n${"x".repeat(1024 * 1024)}`;
    expect((await previewUserImport(db, await viewer("olga"), big)).error).toMatch(/1 MB/);
  });
});
