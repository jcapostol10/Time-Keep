import type { TimeOffPolicyInput } from "@timekeep/core";
import { and, eq, timeOffAdjustment } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { setUpTimeOffCast, type TimeOffCast } from "../../../test/time-off-fixtures";
import { addAdjustment } from "./adjustments";
import { archivePolicy, listPolicies, savePolicy } from "./policies";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: TimeOffCast;
beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
});

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

describe("savePolicy", () => {
  it("is refused to a member with 403", async () => {
    await expect(savePolicy(db, await cast.viewer("bob"), vacation)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("stores the allowance in hundredths", async () => {
    const p = await savePolicy(db, await cast.viewer("ann"), { ...vacation, allowance: "7.5" });
    expect(p).toMatchObject({ name: "Vacation", allowanceCenti: 750, everyone: true });
  });

  it("refuses a second policy with the same name", async () => {
    const ann = await cast.viewer("ann");
    await savePolicy(db, ann, vacation);
    await expect(savePolicy(db, ann, vacation)).rejects.toThrow("already");
  });

  it("refuses assignees from another workspace", async () => {
    await expect(
      savePolicy(db, await cast.viewer("ann"), {
        ...vacation,
        everyone: false,
        userIds: ["someone-else"],
      }),
    ).rejects.toThrow();
  });
});

describe("listPolicies", () => {
  it("lists an everyone policy for a member", async () => {
    await savePolicy(db, await cast.viewer("ann"), vacation);
    expect((await listPolicies(db, await cast.viewer("bob"))).map((p) => p.name)).toEqual([
      "Vacation",
    ]);
  });

  it("lists a group's policy only for the group's members", async () => {
    await savePolicy(db, await cast.viewer("ann"), {
      ...vacation,
      name: "Cebu leave",
      everyone: false,
      groupIds: [cast.cebuId],
    });
    expect((await listPolicies(db, await cast.viewer("bob"))).map((p) => p.name)).toEqual([
      "Cebu leave",
    ]);
    expect(await listPolicies(db, await cast.viewer("max"))).toEqual([]);
    const all = await listPolicies(db, await cast.viewer("olga"));
    expect(all[0]).toMatchObject({ everyone: false, groupIds: [cast.cebuId] });
    // An admin asking for their own (the request dialog) gets only what is assigned to them.
    expect(await listPolicies(db, await cast.viewer("olga"), { mine: true })).toEqual([]);
  });

  it("hides an archived policy from members but not from admins who ask", async () => {
    const ann = await cast.viewer("ann");
    const p = await savePolicy(db, ann, vacation);
    await archivePolicy(db, ann, p.id, true);
    expect(await listPolicies(db, await cast.viewer("bob"))).toEqual([]);
    expect(await listPolicies(db, ann)).toEqual([]);
    expect(await listPolicies(db, ann, { includeArchived: true })).toMatchObject([
      { name: "Vacation", archived: true },
    ]);
  });
});

describe("addAdjustment", () => {
  it("is refused to a manager with 403", async () => {
    const p = await savePolicy(db, await cast.viewer("ann"), vacation);
    await expect(
      addAdjustment(
        db,
        await cast.viewer("max"),
        { policyId: p.id, userId: cast.ids.bob, amount: "2", note: "Carry-over" },
        "2026-11-02",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("stores a signed adjustment dated today", async () => {
    const p = await savePolicy(db, await cast.viewer("ann"), vacation);
    await addAdjustment(
      db,
      await cast.viewer("ann"),
      { policyId: p.id, userId: cast.ids.bob, amount: "-1.5", note: "Correction" },
      "2026-11-02",
    );
    const rows = await db
      .select()
      .from(timeOffAdjustment)
      .where(and(eq(timeOffAdjustment.policyId, p.id), eq(timeOffAdjustment.userId, cast.ids.bob)));
    expect(rows).toMatchObject([
      { amountCenti: -150, effectiveOn: "2026-11-02", note: "Correction" },
    ]);
  });

  it("refuses someone outside the workspace with 404", async () => {
    const p = await savePolicy(db, await cast.viewer("ann"), vacation);
    await expect(
      addAdjustment(
        db,
        await cast.viewer("ann"),
        { policyId: p.id, userId: "nobody", amount: "1", note: "Typo" },
        "2026-11-02",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
