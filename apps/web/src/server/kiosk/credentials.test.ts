import { createHash } from "node:crypto";

import { parseQrPayload } from "@timekeep/core";
import { and, eq, kioskCredential, userGroupMember } from "@timekeep/db";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addMember, connectTestDb, createTestUser, createTestWorkspace } from "../../../test/db";
import { frontDesk, type KioskCast, setUpKioskCast } from "../../../test/kiosk-fixtures";
import { createLimitedUser } from "../limited-users";
import { credentialStatuses, qrToken, setPin } from "./credentials";
import { createKiosk, setKioskDisabled } from "./kiosks";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: KioskCast;
beforeEach(async () => {
  cast = await setUpKioskCast(db);
});

const credential = async (userId: string) => {
  const [r] = await db
    .select()
    .from(kioskCredential)
    .where(and(eq(kioskCredential.workspaceId, cast.wsId), eq(kioskCredential.userId, userId)));
  return r;
};

describe("setPin", () => {
  it("lets a person set their own PIN, hashed", async () => {
    await setPin(db, await cast.viewer("bob"), cast.ids.bob, "0042");
    const c = await credential(cast.ids.bob);
    expect(c?.pinSetAt).not.toBeNull();
    expect(c?.pinHash).not.toContain("0042");
    expect(await verifyPassword({ hash: c?.pinHash ?? "", password: "0042" })).toBe(true);
  });

  it("hides someone else's PIN with 404, unless an admin sets a limited user's", async () => {
    await expect(setPin(db, await cast.viewer("bob"), cast.ids.max, "1234")).rejects.toMatchObject({
      status: 404,
    });
    const ann = await cast.viewer("ann");
    await expect(setPin(db, ann, cast.ids.bob, "1234")).rejects.toMatchObject({ status: 404 });
    const { userId } = await createLimitedUser(db, ann, { name: "Kim Kiosk" });
    await setPin(db, ann, userId, "1234");
    expect((await credential(userId))?.pinHash).toBeTruthy();
  });
});

describe("qrToken", () => {
  it("issues a new code on every call and stores only the last hash", async () => {
    const bob = await cast.viewer("bob");
    const first = await qrToken(db, bob, cast.ids.bob);
    const second = await qrToken(db, bob, cast.ids.bob);
    expect(first.payload).not.toBe(second.payload);
    const token = parseQrPayload(second.payload);
    expect(token).not.toBeNull();
    const c = await credential(cast.ids.bob);
    expect(c?.qrTokenHash).toBe(
      createHash("sha256")
        .update(token ?? "")
        .digest("hex"),
    );
  });
});

describe("credentialStatuses", () => {
  it("lists only workspaces with an active kiosk allowing the person", async () => {
    const ann = await cast.viewer("ann");
    // Another workspace of Bob's with no kiosk is not listed.
    const other = await createTestUser(db, "Other Owner");
    const otherWs = await createTestWorkspace(db, "Elsewhere", other.id);
    await addMember(db, otherWs.id, cast.ids.bob, "member");

    expect(await credentialStatuses(db, cast.ids.bob)).toEqual([]);

    const { kiosk: k } = await createKiosk(
      db,
      ann,
      frontDesk(cast, { everyone: false, groupIds: [cast.cebuId] }),
    );
    await setPin(db, await cast.viewer("bob"), cast.ids.bob, "0042");
    expect(await credentialStatuses(db, cast.ids.bob)).toEqual([
      expect.objectContaining({ workspaceId: cast.wsId, hasPin: true, hasQr: false }),
    ]);
    // Max is not in Cebu.
    expect(await credentialStatuses(db, cast.ids.max)).toEqual([]);

    await db.delete(userGroupMember).where(eq(userGroupMember.userId, cast.ids.bob));
    expect(await credentialStatuses(db, cast.ids.bob)).toEqual([]);

    await db.insert(userGroupMember).values({ groupId: cast.cebuId, userId: cast.ids.bob });
    await setKioskDisabled(db, ann, k.id, true);
    expect(await credentialStatuses(db, cast.ids.bob)).toEqual([]);
  });
});
