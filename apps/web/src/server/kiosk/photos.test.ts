import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ViewerPrefs } from "@timekeep/core";
import { eq, kioskAttempt, kioskPhoto, timeEntry } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { frontDesk, type KioskCast, setUpKioskCast } from "../../../test/kiosk-fixtures";
import { detailedReport } from "../reports";
import { createKiosk } from "./kiosks";
import {
  KIOSK_PHOTO_MAX_BYTES,
  kioskPhotoUrl,
  photoKey,
  purgeKiosk,
  savePunchPhoto,
} from "./photos";

/** Needs the local S3 (RustFS) with the private export bucket: `pnpm storage:init`. */
const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-10-28T04:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let cast: KioskCast;
let entryId: string;
beforeEach(async () => {
  cast = await setUpKioskCast(db);
  entryId = randomUUID();
  await db.insert(timeEntry).values({
    id: entryId,
    workspaceId: cast.wsId,
    userId: cast.ids.bob,
    start: NOW,
    end: new Date(NOW.getTime() + 3_600_000),
    durationSeconds: 3600,
  });
});

const save = (bytes: Uint8Array, now = NOW) =>
  savePunchPhoto(db, { workspaceId: cast.wsId, entryId, bytes }, now);

describe("clock-in photos", () => {
  it("must be a JPEG of at most 1 MiB", async () => {
    await expect(save(PNG)).rejects.toThrow("JPEG");
    const big = new Uint8Array(KIOSK_PHOTO_MAX_BYTES + 1);
    big.set(JPEG);
    await expect(save(big)).rejects.toThrow("JPEG");
    expect(await db.select().from(kioskPhoto)).toEqual([]);
  });

  it("are stored under kiosk-photos/<workspace>/<entry>.jpg and served to kiosk managers only", async () => {
    await save(JPEG);
    const [row] = await db.select().from(kioskPhoto);
    expect(row?.objectKey).toBe(`kiosk-photos/${cast.wsId}/${entryId}.jpg`);
    expect(row?.objectKey).toBe(photoKey(cast.wsId, entryId));

    // Ruling R6: anyone who does not manage kiosks gets the same 404 as no photo.
    await expect(kioskPhotoUrl(db, await cast.viewer("bob"), entryId)).rejects.toMatchObject({
      status: 404,
    });
    const url = await kioskPhotoUrl(db, await cast.viewer("ann"), entryId);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    await expect(kioskPhotoUrl(db, await cast.viewer("ann"), randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("are flagged on Detailed report rows for kiosk managers only (ruling R6)", async () => {
    await save(JPEG);
    const prefs: ViewerPrefs = {
      timezone: "Asia/Manila",
      timeFormat: "24h",
      dateFormat: "yyyy-MM-dd",
      weekStart: 1,
      durationFormat: "hh:mm:ss",
    };
    const query = {
      ...DEFAULT_REPORT_QUERY,
      preset: "custom" as const,
      from: "2026-10-27T16:00:00.000Z",
      to: "2026-10-28T16:00:00.000Z",
    };
    const rows = async (who: "ann" | "max") =>
      (
        await detailedReport(
          db,
          await cast.viewer(who),
          query,
          prefs,
          { sort: "start", dir: "asc" },
          NOW,
        )
      ).entries.map((e) => e.photo);
    expect(await rows("ann")).toEqual([true]);
    expect(await rows("max")).toEqual([false]);
  });

  it("are purged after 90 days, and attempts after a day", async () => {
    const { kiosk } = await createKiosk(db, await cast.viewer("ann"), frontDesk(cast));
    await save(JPEG);
    const url = await kioskPhotoUrl(db, await cast.viewer("ann"), entryId);
    await db.insert(kioskAttempt).values([
      { id: randomUUID(), kioskId: kiosk.id, method: "PIN", success: false, createdAt: NOW },
      {
        id: randomUUID(),
        kioskId: kiosk.id,
        method: "PIN",
        success: false,
        createdAt: new Date(NOW.getTime() + 90 * DAY),
      },
    ]);

    expect(await purgeKiosk(db, new Date(NOW.getTime() + 89 * DAY))).toEqual({
      photos: 0,
      attempts: 1,
    });
    expect(await purgeKiosk(db, new Date(NOW.getTime() + 91 * DAY))).toEqual({
      photos: 1,
      attempts: 0,
    });
    expect(await db.select().from(kioskPhoto).where(eq(kioskPhoto.entryId, entryId))).toEqual([]);
    expect((await fetch(url)).status).toBe(404);
  });
});
