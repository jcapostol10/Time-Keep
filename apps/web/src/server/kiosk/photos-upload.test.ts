import { randomUUID } from "node:crypto";

import { eq, kioskPhoto, timeEntry } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../../../test/db";
import { type KioskCast, setUpKioskCast } from "../../../test/kiosk-fixtures";

/** Storage that records uploads, and refuses them while `failing` is set. */
const store = vi.hoisted(() => ({ uploads: [] as string[], failing: false }));
vi.mock("../storage", () => ({
  uploadExport: async (args: { key: string }) => {
    if (store.failing) throw new Error("S3 is down");
    store.uploads.push(args.key);
  },
  deleteExport: async () => {},
  presignedExportUrl: async () => "https://signed.test/x",
}));

const { savePunchPhoto } = await import("./photos");

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-10-28T04:00:00.000Z");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

let cast: KioskCast;
let entryId: string;
beforeEach(async () => {
  store.uploads = [];
  store.failing = false;
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

describe("saving a clock-in photo", () => {
  it("uploads nothing when its row cannot be written, so no object is left that the purge never finds", async () => {
    await expect(
      savePunchPhoto(db, { workspaceId: cast.wsId, entryId: randomUUID(), bytes: JPEG }, NOW),
    ).rejects.toThrow();
    expect(store.uploads).toEqual([]);
  });

  it("leaves no row when the upload fails", async () => {
    store.failing = true;
    await expect(
      savePunchPhoto(db, { workspaceId: cast.wsId, entryId, bytes: JPEG }, NOW),
    ).rejects.toThrow("S3 is down");
    expect(await db.select().from(kioskPhoto).where(eq(kioskPhoto.entryId, entryId))).toEqual([]);
  });
});
