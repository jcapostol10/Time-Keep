import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { managedUser } from "@timekeep/db";
import { unzipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { createExpenseCategory } from "./expense-categories";
import { receiptKeys } from "./expense-receipts";
import { createExpense, setReceipt } from "./expenses";
import { buildReceiptsZip } from "./receipts-zip";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-10-28T04:00:00.000Z");
const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const QUERY: ReportQuery = { ...DEFAULT_REPORT_QUERY, preset: "this-month" };

let wsId: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

beforeEach(async () => {
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
  await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
  const owner = await viewer("olga");
  ids.web = (await createProject(db, owner, { name: "Web" })).id;
  ids.travel = (
    await createExpenseCategory(db, owner, {
      name: "Travel / Taxi",
      kind: "FIXED",
      unitName: null,
      unitPriceMinor: null,
      billableDefault: true,
    })
  ).id;
  const spend = async (
    who: string,
    amountMinor: number,
    description: string,
    mime?: "image/jpeg" | "application/pdf",
  ) => {
    const v = await viewer(who);
    const e = await createExpense(
      db,
      v,
      {
        projectId: ids.web!,
        categoryId: ids.travel!,
        date: "2026-10-20",
        amountMinor,
        billable: true,
        description,
      },
      { now: NOW },
    );
    if (mime) {
      const keys = receiptKeys(wsId, e.id);
      await setReceipt(db, v, e.id, { fileKey: keys.file, thumbKey: null, mime }, { now: NOW });
    }
    return e;
  };
  ids.bobs = (await spend("bob", 12_550, "Taxi, airport", "image/jpeg")).id;
  ids.carols = (await spend("carol", 3_000, "Lunch", "application/pdf")).id;
  await spend("olga", 500, "No receipt");
});

describe("buildReceiptsZip", () => {
  it("zips every receipt in scope with a manifest", async () => {
    const fetched: string[] = [];
    const fetch = async (key: string) => {
      fetched.push(key);
      return new TextEncoder().encode(`bytes of ${key}`);
    };
    const file = await buildReceiptsZip(
      db,
      await viewer("olga"),
      { query: QUERY, prefs: PREFS, now: NOW },
      fetch,
    );
    expect(file.filename).toBe("timekeep-receipts-2026-10-01-2026-10-31.zip");
    expect(file.contentType).toBe("application/zip");
    expect(file.rowCount).toBe(2);
    const entries = unzipSync(file.body);
    const names = Object.keys(entries).sort();
    expect(names).toEqual(
      [
        "expenses.csv",
        `2026-10-20-Bob_Member-Travel_Taxi-${ids.bobs!.slice(0, 8)}.jpg`,
        `2026-10-20-Carol_Member-Travel_Taxi-${ids.carols!.slice(0, 8)}.pdf`,
      ].sort(),
    );
    expect(fetched.sort()).toEqual(
      [receiptKeys(wsId, ids.bobs!).file, receiptKeys(wsId, ids.carols!).file].sort(),
    );
    // Sorted: Bob's file first.
    expect(text(entries[names[0]!]!)).toBe(`bytes of ${receiptKeys(wsId, ids.bobs!).file}`);
    // TextDecoder consumes the BOM the manifest starts with.
    const manifest = text(entries["expenses.csv"]!).split("\r\n");
    expect(manifest[0]).toBe(
      "Date,Person,Project,Client,Category,Quantity,Amount,Currency,Billable,Description,Receipt file",
    );
    // Every expense of the query is in the manifest, with or without a receipt.
    expect(manifest.filter((l) => l.length > 0)).toHaveLength(4);
    expect(manifest.find((l) => l.includes("Bob Member"))).toBe(
      `2026-10-20,Bob Member,Web,,Travel / Taxi,,125.50,USD,Yes,"Taxi, airport",2026-10-20-Bob_Member-Travel_Taxi-${ids.bobs!.slice(0, 8)}.jpg`,
    );
    expect(manifest.find((l) => l.includes("No receipt"))).toBe(
      "2026-10-20,Olga Owner,Web,,Travel / Taxi,,5.00,USD,Yes,No receipt,",
    );
  });

  it("holds only the viewer's receipts: a member's own, a manager's people's", async () => {
    const fetch = async () => new Uint8Array([1]);
    const bob = await buildReceiptsZip(
      db,
      await viewer("bob"),
      { query: QUERY, prefs: PREFS, now: NOW },
      fetch,
    );
    expect(bob.rowCount).toBe(1);
    expect(Object.keys(unzipSync(bob.body)).filter((n) => n !== "expenses.csv")).toEqual([
      `2026-10-20-Bob_Member-Travel_Taxi-${ids.bobs!.slice(0, 8)}.jpg`,
    ]);
    const max = await buildReceiptsZip(
      db,
      await viewer("max"),
      { query: QUERY, prefs: PREFS, now: NOW },
      fetch,
    );
    expect(max.rowCount).toBe(1);
    // A person filter outside a member's own narrows to nothing it may not see.
    const carolsView = await buildReceiptsZip(
      db,
      await viewer("carol"),
      { query: { ...QUERY, userIds: [ids.bob!] }, prefs: PREFS, now: NOW },
      fetch,
    );
    expect(carolsView.rowCount).toBe(1);
    expect(Object.keys(unzipSync(carolsView.body))).toContain(
      `2026-10-20-Carol_Member-Travel_Taxi-${ids.carols!.slice(0, 8)}.pdf`,
    );
  });
});
