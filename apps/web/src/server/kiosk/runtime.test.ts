import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { and, eq, isNull, kioskAttempt, membership, timeEntry, user } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addMember, connectTestDb, createTestUser, createTestWorkspace } from "../../../test/db";
import { frontDesk, type KioskCast, setUpKioskCast } from "../../../test/kiosk-fixtures";
import { submitPeriod } from "../approvals";
import { loadViewer } from "../authz";
import { PENDING_MESSAGE } from "../entry-guard";
import { detailedReport } from "../reports";
import { qrToken, setPin } from "./credentials";
import { createKiosk, rotateKioskToken, updateKiosk } from "./kiosks";
import { identify, kioskPeople, punch, type ResolvedKiosk, resolveKiosk } from "./runtime";

const handle = connectTestDb();
const second = connectTestDb();
const db = handle.db;
afterAll(async () => {
  await handle.close();
  await second.close();
});

/** Wednesday 28 October 2026, noon in Manila (Monday weeks). */
const NOW = new Date("2026-10-28T04:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let cast: KioskCast;
let kioskId: string;
let token: string;
let k: ResolvedKiosk;

const tokenOf = (url: string) => url.split("/kiosk/")[1] ?? "";

beforeEach(async () => {
  cast = await setUpKioskCast(db);
  await cast.setRules({ allowBreaks: true, approvalEnabled: true });
  const created = await createKiosk(
    db,
    await cast.viewer("ann"),
    frontDesk(cast, { taskId: cast.taskT }),
  );
  kioskId = created.kiosk.id;
  token = tokenOf(created.url);
  k = await resolveKiosk(db, token);
  await setPin(db, await cast.viewer("bob"), cast.ids.bob, "0042");
});

const bobPin = (pin = "0042", when = NOW) => identify(db, k, { userId: cast.ids.bob, pin }, when);

async function act(action: Parameters<typeof punch>[2]["action"], minutes: number) {
  const visit = await bobPin("0042", at(minutes));
  return punch(db, k, { ticket: visit.ticket, action }, null, at(minutes));
}

const bobEntries = () =>
  db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.userId, cast.ids.bob), isNull(timeEntry.deletedAt)))
    .orderBy(timeEntry.start);

describe("resolveKiosk and kioskPeople", () => {
  it("refuse an unknown token with the one 404", async () => {
    await expect(resolveKiosk(db, "nope")).rejects.toMatchObject({
      status: 404,
      message: "This kiosk is not available.",
    });
  });

  it("list the allowed active members by name, with whether they have a PIN", async () => {
    await db
      .update(membership)
      .set({ status: "DEACTIVATED" })
      .where(eq(membership.userId, cast.ids.max));
    const people = await kioskPeople(db, k);
    expect(people.map((p) => p.name)).toEqual(["Ann Admin", "Bob Member", "Olga Owner"]);
    expect(people.find((p) => p.userId === cast.ids.bob)?.hasPin).toBe(true);
    expect(people.find((p) => p.userId === cast.ids.ann)?.hasPin).toBe(false);
  });
});

describe("punches", () => {
  it("clock in, break and clock out write normal entries", async () => {
    const visit = await bobPin();
    expect(visit).toMatchObject({ state: "OUT", actions: ["CLOCK_IN"] });

    expect(await act("CLOCK_IN", 0)).toMatchObject({ state: "IN" });
    const [work] = await bobEntries();
    expect(work).toMatchObject({
      description: "Kiosk: Front desk",
      projectId: cast.projectP,
      taskId: cast.taskT,
      billable: true,
      type: "work",
      end: null,
    });
    expect(work?.start).toEqual(NOW);

    expect(await act("START_BREAK", 60)).toMatchObject({ state: "BREAK" });
    let rows = await bobEntries();
    expect(rows.map((r) => [r.type, r.end !== null])).toEqual([
      ["work", true],
      ["break", false],
    ]);

    expect(await act("END_BREAK", 90)).toMatchObject({ state: "IN" });
    rows = await bobEntries();
    expect(rows.map((r) => [r.type, r.end !== null])).toEqual([
      ["work", true],
      ["break", true],
      ["work", false],
    ]);

    const out = await act("CLOCK_OUT", 150);
    expect(out).toMatchObject({ state: "OUT", workedTodaySeconds: 2 * 3600 });
    expect((await bobEntries()).every((r) => r.end !== null)).toBe(true);

    const prefs: ViewerPrefs = {
      timezone: "Asia/Manila",
      timeFormat: "24h",
      dateFormat: "yyyy-MM-dd",
      weekStart: 1,
      durationFormat: "hh:mm:ss",
    };
    const query: ReportQuery = {
      ...DEFAULT_REPORT_QUERY,
      preset: "custom",
      from: "2026-10-27T16:00:00.000Z",
      to: "2026-10-28T16:00:00.000Z",
    };
    const page = await detailedReport(
      db,
      await cast.viewer("ann"),
      query,
      prefs,
      { sort: "start", dir: "asc" },
      at(200),
    );
    expect(page.entries.map((e) => e.description)).toEqual([
      "Kiosk: Front desk",
      "Kiosk: Front desk",
    ]);
  });

  it("offers no break when the workspace has breaks off", async () => {
    await act("CLOCK_IN", 0);
    await cast.setRules({ allowBreaks: false });
    k = await resolveKiosk(db, token);
    const visit = await bobPin("0042", at(10));
    expect(visit.actions).toEqual(["CLOCK_OUT"]);
    await expect(
      punch(db, k, { ticket: visit.ticket, action: "START_BREAK" }, null, at(10)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("answers an action that does not fit the state with 409 and the fresh state", async () => {
    await act("CLOCK_IN", 0);
    await expect(act("CLOCK_IN", 5)).rejects.toMatchObject({
      status: 409,
      extra: { visit: { state: "IN" } },
    });
    expect(await bobEntries()).toHaveLength(1);
  });

  it("refuses to clock in to a submitted week, writing nothing (Review Focus 1)", async () => {
    await submitPeriod(db, await cast.viewer("bob"), "2026-10-26", NOW);
    await expect(act("CLOCK_IN", 0)).rejects.toThrow(PENDING_MESSAGE);
    expect(await bobEntries()).toEqual([]);
  });

  it("still clocks in under force timer", async () => {
    await cast.setRules({ forceTimer: true });
    expect(await act("CLOCK_IN", 0)).toMatchObject({ state: "IN" });
  });

  it("blocks clock out when a required field is missing", async () => {
    await act("CLOCK_IN", 0);
    await cast.setRules({ requiredFields: ["tag"] });
    await expect(act("CLOCK_OUT", 30)).rejects.toThrow(/tag/i);
    expect((await bobEntries())[0]?.end).toBeNull();
  });
});

describe("tickets across changes", () => {
  it("are refused after the kiosk is rotated (Review Focus 2)", async () => {
    const visit = await bobPin();
    const { url } = await rotateKioskToken(db, await cast.viewer("ann"), kioskId, at(1));
    await expect(resolveKiosk(db, token)).rejects.toMatchObject({ status: 404 });
    const rotated = await resolveKiosk(db, tokenOf(url));
    await expect(
      punch(db, rotated, { ticket: visit.ticket, action: "CLOCK_IN" }, null, at(1)),
    ).rejects.toMatchObject({ status: 404 });
    expect(await bobEntries()).toEqual([]);
  });

  it("are refused once the person is no longer allowed (Review Focus 3)", async () => {
    const ann = await cast.viewer("ann");
    await updateKiosk(
      db,
      ann,
      kioskId,
      frontDesk(cast, { everyone: false, userIds: [cast.ids.bob] }),
    );
    k = await resolveKiosk(db, token);
    const visit = await bobPin();
    await updateKiosk(
      db,
      ann,
      kioskId,
      frontDesk(cast, { everyone: false, userIds: [cast.ids.max] }),
    );
    await expect(
      punch(db, k, { ticket: visit.ticket, action: "CLOCK_IN" }, null, NOW),
    ).rejects.toMatchObject({ status: 404 });
    expect(await bobEntries()).toEqual([]);
  });
});

describe("PIN throttles", () => {
  it("lock a person for 15 minutes from the fifth wrong PIN, even with the right one", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(bobPin("9999", at(i))).rejects.toMatchObject({ code: "WRONG_PIN" });
    }
    await expect(bobPin("0042", at(5))).rejects.toMatchObject({
      code: "PERSON_LOCKED",
      message: "Too many wrong PINs. Try again in 15 minutes.",
      extra: { until: at(19) },
    });
    expect((await bobPin("0042", at(19))).state).toBe("OUT");
  });

  it("count only the failures since the last success", async () => {
    for (let i = 0; i < 4; i++) await expect(bobPin("9999", at(i))).rejects.toThrow("Wrong PIN.");
    await bobPin("0042", at(4));
    for (let i = 5; i < 9; i++) await expect(bobPin("9999", at(i))).rejects.toThrow("Wrong PIN.");
    expect((await bobPin("0042", at(9))).state).toBe("OUT");
  });

  it("pause the kiosk's PIN entry after 30 failures, while QR still works", async () => {
    await db.insert(kioskAttempt).values(
      Array.from({ length: 30 }, (_, i) => ({
        id: randomUUID(),
        kioskId,
        userId: null,
        method: "PIN" as const,
        success: false,
        createdAt: at(i / 3),
      })),
    );
    await expect(bobPin("0042", at(11))).rejects.toMatchObject({
      code: "KIOSK_PIN_LOCKED",
      message: "PIN entry is paused for 15 minutes. Scan your QR code instead.",
    });
    const { payload } = await qrToken(db, await cast.viewer("bob"), cast.ids.bob);
    expect((await identify(db, k, { qr: payload }, at(11))).person.userId).toBe(cast.ids.bob);
  });

  it("record at most five failures for ten parallel wrong PINs (Review Focus 4)", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        identify(i % 2 ? second.db : db, k, { userId: cast.ids.bob, pin: "9999" }, at(0)),
      ),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const failures = await db
      .select()
      .from(kioskAttempt)
      .where(and(eq(kioskAttempt.userId, cast.ids.bob), eq(kioskAttempt.success, false)));
    expect(failures).toHaveLength(5);
  });
});

describe("QR codes", () => {
  it("refuse a code from another workspace, and ignore text that is not a code", async () => {
    const other = await createTestUser(db, "Other Owner");
    const otherWs = await createTestWorkspace(db, "Elsewhere", other.id);
    await addMember(db, otherWs.id, cast.ids.bob, "member");
    const { payload } = await qrToken(
      db,
      await loadViewer(db, otherWs.id, cast.ids.bob),
      cast.ids.bob,
    );
    await expect(identify(db, k, { qr: payload }, NOW)).rejects.toMatchObject({
      code: "QR_INVALID",
      message: "This QR code is not valid on this kiosk.",
    });
    await expect(identify(db, k, { qr: "https://example.com" }, NOW)).rejects.toMatchObject({
      code: "QR_INVALID",
    });
    expect(await db.select().from(kioskAttempt)).toHaveLength(1);
  });
});

describe("worked today", () => {
  it("sums the person's own day in their timezone, the running entry up to now (Review Focus 5)", async () => {
    await cast.setRules({ timezone: "America/New_York" });
    await db.update(user).set({ timezone: "Asia/Manila" }).where(eq(user.id, cast.ids.bob));
    k = await resolveKiosk(db, token);
    const entry = (start: string, end: string | null) => ({
      id: randomUUID(),
      workspaceId: cast.wsId,
      userId: cast.ids.bob,
      start: new Date(start),
      end: end ? new Date(end) : null,
      durationSeconds: end ? (Date.parse(end) - Date.parse(start)) / 1000 : null,
    });
    await db.insert(timeEntry).values([
      // Manila 28 Oct 01:00–02:00 (New York 27 Oct): counted.
      entry("2026-10-27T17:00:00.000Z", "2026-10-27T18:00:00.000Z"),
      // Manila 27 Oct 23:00: another day.
      entry("2026-10-27T15:00:00.000Z", "2026-10-27T15:30:00.000Z"),
      // Running since 11:30 Manila: 30 minutes by noon.
      entry("2026-10-28T03:30:00.000Z", null),
    ]);
    expect((await bobPin()).workedTodaySeconds).toBe(5400);
  });
});
