import { createHash } from "node:crypto";

import { eq, kiosk } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { frontDesk, type KioskCast, setUpKioskCast } from "../../../test/kiosk-fixtures";
import { createKiosk, listKiosks, rotateKioskToken, setKioskDisabled, updateKiosk } from "./kiosks";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: KioskCast;
beforeEach(async () => {
  cast = await setUpKioskCast(db);
});

const tokenOf = (url: string) => url.split("/kiosk/")[1] ?? "";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const row = async (id: string) => {
  const [r] = await db.select().from(kiosk).where(eq(kiosk.id, id));
  if (!r) throw new Error("no kiosk");
  return r;
};

describe("kiosks", () => {
  it("are managed by owners and admins only", async () => {
    await expect(createKiosk(db, await cast.viewer("max"), frontDesk(cast))).rejects.toMatchObject({
      status: 403,
    });
    await expect(listKiosks(db, await cast.viewer("bob"))).rejects.toMatchObject({ status: 403 });
  });

  it("store only the sha256 of the device token", async () => {
    const { kiosk: k, url } = await createKiosk(db, await cast.viewer("ann"), frontDesk(cast));
    expect(url).toMatch(/\/kiosk\/[A-Za-z0-9_-]{43}$/);
    expect((await row(k.id)).tokenHash).toBe(sha256(tokenOf(url)));
    expect(k).toMatchObject({ name: "Front desk", projectId: cast.projectP, disabled: false });
  });

  it("rotate changes the hash and the rotation time", async () => {
    const ann = await cast.viewer("ann");
    const { kiosk: k, url } = await createKiosk(db, ann, frontDesk(cast));
    const before = await row(k.id);
    const rotated = await rotateKioskToken(
      db,
      ann,
      k.id,
      new Date(before.tokenRotatedAt.getTime() + 60_000),
    );
    const after = await row(k.id);
    expect(tokenOf(rotated.url)).not.toBe(tokenOf(url));
    expect(after.tokenHash).toBe(sha256(tokenOf(rotated.url)));
    expect(after.tokenRotatedAt.getTime()).toBeGreaterThan(before.tokenRotatedAt.getTime());
  });

  it("refuse a task from another project", async () => {
    await expect(
      createKiosk(db, await cast.viewer("ann"), frontDesk(cast, { taskId: cast.taskU })),
    ).rejects.toThrow(/task/i);
  });

  it("keep the photo setting, people and groups", async () => {
    const ann = await cast.viewer("ann");
    const { kiosk: k } = await createKiosk(db, ann, frontDesk(cast, { photo: true }));
    expect((await row(k.id)).photo).toBe(true);
    const updated = await updateKiosk(
      db,
      ann,
      k.id,
      frontDesk(cast, { everyone: false, userIds: [cast.ids.bob], groupIds: [cast.cebuId] }),
    );
    expect(updated).toMatchObject({
      everyone: false,
      userIds: [cast.ids.bob],
      groupIds: [cast.cebuId],
    });
    expect((await listKiosks(db, ann)).map((x) => x.id)).toEqual([k.id]);
  });

  it("disable sets disabled_at, and enable clears it", async () => {
    const ann = await cast.viewer("ann");
    const { kiosk: k } = await createKiosk(db, ann, frontDesk(cast));
    await setKioskDisabled(db, ann, k.id, true);
    expect((await row(k.id)).disabledAt).not.toBeNull();
    await setKioskDisabled(db, ann, k.id, false);
    expect((await row(k.id)).disabledAt).toBeNull();
  });
});
