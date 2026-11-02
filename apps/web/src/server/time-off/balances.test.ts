import type { TimeOffPolicyInput } from "@timekeep/core";
import { timeOffPolicy } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { setUpTimeOffCast, type TimeOffCast } from "../../../test/time-off-fixtures";
import { addAdjustment } from "./adjustments";
import { listBalances } from "./balances";
import { savePolicy } from "./policies";
import { requestTimeOff, reviewTimeOff } from "./requests";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-11-02T04:00:00.000Z");
const TODAY = "2026-11-02";

let cast: TimeOffCast;
let vacationId: string;

const vacation: TimeOffPolicyInput = {
  name: "Vacation",
  unit: "DAYS",
  accrual: "YEARLY",
  allowance: "15",
  allowNegative: false,
  requiresApproval: true,
  everyone: true,
  userIds: [],
  groupIds: [],
};

const ask = (start: string, end: string) => ({
  policyId: vacationId,
  start,
  end,
  halfDay: false,
  note: "",
});

beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
  vacationId = (await savePolicy(db, await cast.viewer("ann"), vacation)).id;
  await db.update(timeOffPolicy).set({ createdAt: new Date("2025-01-01T00:00:00Z") });
});

const vacationOf = async (who: keyof TimeOffCast["ids"], userId?: string) =>
  (await listBalances(db, await cast.viewer(who), { userId, today: TODAY })).find(
    (b) => b.policyId === vacationId && b.userId === (userId ?? cast.ids[who]),
  );

describe("listBalances", () => {
  it("subtracts approved time and shows pending apart", async () => {
    const bob = await cast.viewer("bob");
    const approved = await requestTimeOff(db, bob, ask("2026-11-09", "2026-11-12"), NOW);
    await reviewTimeOff(db, await cast.viewer("ann"), { ids: [approved.id], decision: "APPROVE" });
    await requestTimeOff(db, bob, ask("2026-11-16", "2026-11-16"), NOW);
    expect((await vacationOf("bob"))?.balance).toMatchObject({
      grantedCenti: 1500,
      usedCenti: 400,
      pendingCenti: 100,
      balanceCenti: 1100,
    });
  });

  it("adds a signed adjustment", async () => {
    await addAdjustment(
      db,
      await cast.viewer("ann"),
      { policyId: vacationId, userId: cast.ids.bob, amount: "-2", note: "Correction" },
      TODAY,
    );
    expect((await vacationOf("bob"))?.balance.balanceCenti).toBe(1300);
  });

  it("lets a manager see their people, and a member nobody else", async () => {
    expect(await vacationOf("max", cast.ids.bob)).toMatchObject({ userName: "Bob Member" });
    await expect(
      listBalances(db, await cast.viewer("bob"), { userId: cast.ids.max, today: TODAY }),
    ).rejects.toMatchObject({ status: 404 });
    const mine = await listBalances(db, await cast.viewer("bob"), { today: TODAY });
    expect(new Set(mine.map((b) => b.userId))).toEqual(new Set([cast.ids.bob]));
    const all = await listBalances(db, await cast.viewer("olga"), { today: TODAY });
    expect(new Set(all.map((b) => b.userId)).size).toBe(4);
  });

  it("counts last year's time off in last year only", async () => {
    const bob = await cast.viewer("bob");
    const old = await requestTimeOff(db, bob, ask("2025-12-01", "2025-12-02"), NOW);
    await reviewTimeOff(db, await cast.viewer("ann"), { ids: [old.id], decision: "APPROVE" });
    expect((await vacationOf("bob"))?.balance.balanceCenti).toBe(1500);
  });
});

describe("balances stay private (review fix)", () => {
  it("never shows a member a colleague's balances, even when the team's time is shared", async () => {
    await cast.setRules({ membersSeeTeamTime: true });
    await expect(
      listBalances(db, await cast.viewer("bob"), { userId: cast.ids.max, today: TODAY }),
    ).rejects.toMatchObject({ status: 404 });
    const mine = await listBalances(db, await cast.viewer("bob"), { today: TODAY });
    expect(new Set(mine.map((b) => b.userId))).toEqual(new Set([cast.ids.bob]));
  });
});
