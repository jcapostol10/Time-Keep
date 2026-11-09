import { randomUUID } from "node:crypto";

import { approvalRequest, eq, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";

const store = vi.hoisted(() => ({
  uploads: [] as { key: string; contentType: string; size: number }[],
  deletes: [] as string[],
}));
vi.mock("./storage", () => ({
  uploadExport: async (args: { key: string; body: Uint8Array; contentType: string }) => {
    store.uploads.push({ key: args.key, contentType: args.contentType, size: args.body.length });
  },
  deleteExport: async (key: string) => {
    store.deletes.push(key);
  },
  presignedExportUrl: async (key: string, ttl: number, filename: string) =>
    `https://signed.test/${key}?ttl=${ttl}&name=${encodeURIComponent(filename)}`,
}));

const { loadViewer, scopeForUser } = await import("./authz");
const { createProject } = await import("./catalog/projects");
const { PENDING_MESSAGE } = await import("./entry-guard");
const { createExpenseCategory } = await import("./expense-categories");
const { assertReceipt, receiptKeys, receiptUrl, removeReceipt, saveReceipt } =
  await import("./expense-receipts");
const { createExpense, getExpense } = await import("./expenses");

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-10-28T04:00:00.000Z");
const MB = 1024 * 1024;

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3);
const pdfOf = (size: number) => {
  const out = new Uint8Array(size);
  out.set(bytes("%PDF-1.7"));
  return out;
};

let wsId: string;
let ids: Record<string, string>;
let webId: string;
let travelId: string;
const viewer = (who: string) => loadViewer(db, wsId, ids[who]!);

beforeEach(async () => {
  store.uploads = [];
  store.deletes = [];
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const max = await createTestUser(db, "Max Manager");
  const bob = await createTestUser(db, "Bob Member");
  const carol = await createTestUser(db, "Carol Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  wsId = ws.id;
  ids = { olga: olga.id, max: max.id, bob: bob.id, carol: carol.id };
  await addMember(db, wsId, max.id, "manager");
  await addMember(db, wsId, bob.id, "member");
  await addMember(db, wsId, carol.id, "member");
  await db
    .update(workspaceSettings)
    .set({ timezone: "Asia/Manila", weekStart: 1, approvalEnabled: true })
    .where(eq(workspaceSettings.workspaceId, wsId));
  const owner = await viewer("olga");
  webId = (await createProject(db, owner, { name: "Web" })).id;
  travelId = (
    await createExpenseCategory(db, owner, {
      name: "Travel",
      kind: "FIXED",
      unitName: null,
      unitPriceMinor: null,
      billableDefault: true,
    })
  ).id;
});

async function bobsExpense(date = "2026-10-27") {
  return createExpense(
    db,
    await viewer("bob"),
    {
      projectId: webId,
      categoryId: travelId,
      date,
      amountMinor: 1000,
      billable: true,
      description: "",
    },
    { now: NOW },
  );
}

describe("assertReceipt", () => {
  it("trusts bytes, not names", () => {
    expect(assertReceipt(JPEG, "image/jpeg")).toBe("image/jpeg");
    // A JPEG named .png (the browser declares the type from the name): stored as a JPEG.
    expect(assertReceipt(JPEG, "image/png")).toBe("image/jpeg");
    expect(assertReceipt(JPEG, "")).toBe("image/jpeg");
    // A PDF declared as an image, or an image declared as a PDF: refused.
    expect(() => assertReceipt(pdfOf(20), "image/png")).toThrow(
      "Receipts are JPEG, PNG, WebP or PDF files.",
    );
    expect(() => assertReceipt(JPEG, "application/pdf")).toThrow(
      "Receipts are JPEG, PNG, WebP or PDF files.",
    );
    expect(() => assertReceipt(bytes("GIF89a"), "image/gif")).toThrow(
      "Receipts are JPEG, PNG, WebP or PDF files.",
    );
    expect(assertReceipt(pdfOf(4 * MB), "application/pdf")).toBe("application/pdf");
    expect(() => assertReceipt(pdfOf(4 * MB + 1), "application/pdf")).toThrow(
      "A receipt is at most 4 MB.",
    );
  });
});

describe("saveReceipt", () => {
  it("stores keys and mime, replaces an old receipt, and the guard applies", async () => {
    const e = await bobsExpense();
    const keys = receiptKeys(wsId, e.id);
    expect(keys).toEqual({
      file: `receipts/${wsId}/${e.id}`,
      thumb: `receipts/${wsId}/${e.id}.thumb.jpg`,
    });
    const saved = await saveReceipt(
      db,
      await viewer("bob"),
      e.id,
      { bytes: JPEG, mime: "image/jpeg", thumb: JPEG },
      { now: NOW },
    );
    expect(saved.receipt).toEqual({ mime: "image/jpeg", thumb: true });
    expect(store.uploads.map((u) => [u.key, u.contentType])).toEqual([
      [keys.file, "image/jpeg"],
      [keys.thumb, "image/jpeg"],
    ]);
    // A PDF replaces it: no thumbnail, so the old one is deleted after the row changes.
    store.uploads = [];
    const replaced = await saveReceipt(
      db,
      await viewer("bob"),
      e.id,
      { bytes: pdfOf(100), mime: "application/pdf", thumb: null },
      { now: NOW },
    );
    expect(replaced.receipt).toEqual({ mime: "application/pdf", thumb: false });
    expect(store.uploads.map((u) => u.key)).toEqual([keys.file]);
    expect(store.deletes).toEqual([keys.thumb]);
    // A thumbnail that is not a small JPEG is ignored.
    store.uploads = [];
    const noThumb = await saveReceipt(
      db,
      await viewer("bob"),
      e.id,
      { bytes: JPEG, mime: "image/jpeg", thumb: pdfOf(10) },
      { now: NOW },
    );
    expect(noThumb.receipt).toEqual({ mime: "image/jpeg", thumb: false });
    expect(store.uploads).toHaveLength(1);
  });

  it("is refused in a pending period for the owner, and uploads nothing", async () => {
    const e = await bobsExpense("2026-10-20");
    await db.insert(approvalRequest).values({
      id: randomUUID(),
      workspaceId: wsId,
      userId: ids.bob!,
      periodStart: "2026-10-19",
      periodEnd: "2026-10-25",
      status: "PENDING",
    });
    await expect(
      saveReceipt(
        db,
        await viewer("bob"),
        e.id,
        { bytes: JPEG, mime: "image/jpeg", thumb: null },
        {
          now: NOW,
        },
      ),
    ).rejects.toThrow(PENDING_MESSAGE);
    expect(store.uploads).toEqual([]);
    // An admin saves it with a note.
    await expect(
      saveReceipt(
        db,
        await viewer("olga"),
        e.id,
        { bytes: JPEG, mime: "image/jpeg", thumb: null },
        {
          now: NOW,
        },
      ),
    ).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    const saved = await saveReceipt(
      db,
      await viewer("olga"),
      e.id,
      { bytes: JPEG, mime: "image/jpeg", thumb: null },
      { now: NOW, note: "Receipt came in late" },
    );
    expect(saved.receipt?.mime).toBe("image/jpeg");
  });

  it("a manager saves for their people only, and removal deletes the objects", async () => {
    const e = await bobsExpense();
    await expect(
      saveReceipt(
        db,
        await viewer("max"),
        e.id,
        { bytes: JPEG, mime: "image/jpeg", thumb: null },
        {
          now: NOW,
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await saveReceipt(
      db,
      await viewer("bob"),
      e.id,
      { bytes: JPEG, mime: "image/jpeg", thumb: JPEG },
      { now: NOW },
    );
    const removed = await removeReceipt(db, await viewer("bob"), e.id, { now: NOW });
    expect(removed.receipt).toBeNull();
    const keys = receiptKeys(wsId, e.id);
    expect(store.deletes.sort()).toEqual([keys.file, keys.thumb].sort());
    expect((await getExpense(db, await viewer("bob"), e.id)).receipt).toBeNull();
    // The scope helper agrees: a stranger is not found.
    await expect(scopeForUser(db, await viewer("carol"), ids.bob!)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("receiptUrl", () => {
  it("is 404 for someone outside the scope and without a receipt", async () => {
    const e = await bobsExpense();
    await expect(receiptUrl(db, await viewer("bob"), e.id, {})).rejects.toMatchObject({
      status: 404,
    });
    await saveReceipt(
      db,
      await viewer("bob"),
      e.id,
      { bytes: pdfOf(50), mime: "application/pdf", thumb: null },
      { now: NOW },
    );
    const keys = receiptKeys(wsId, e.id);
    expect(await receiptUrl(db, await viewer("bob"), e.id, {})).toBe(
      `https://signed.test/${keys.file}?ttl=300&name=receipt.pdf`,
    );
    // Owners read everyone's; a colleague reads nobody's; no thumbnail for a PDF.
    expect(await receiptUrl(db, await viewer("olga"), e.id, {})).toContain(keys.file);
    await expect(receiptUrl(db, await viewer("carol"), e.id, {})).rejects.toMatchObject({
      status: 404,
    });
    await expect(receiptUrl(db, await viewer("bob"), e.id, { thumb: true })).rejects.toMatchObject({
      status: 404,
    });
    await expect(receiptUrl(db, await viewer("bob"), randomUUID(), {})).rejects.toMatchObject({
      status: 404,
    });
  });
});
