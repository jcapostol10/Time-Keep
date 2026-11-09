import type { EstimateInput } from "@timekeep/core";
import { and, emailOutbox, eq, like, project, projectMember } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../test/db";
import { setUpTimeOffCast, type TimeOffCast } from "../../test/time-off-fixtures";
import { setProjectEstimate } from "./budgets";
import { createProject } from "./catalog/projects";
import { runDailyJobs } from "./daily-jobs";
import { createManualEntry } from "./time-entries";

// Phase 6b, decision 13: the daily job checks every estimated project once a
// day and emails each threshold crossed once per project and period, to the
// active owners and admins and the project's managers.

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

/** Sunday 8 Nov 06:00 in Manila. */
const NOW = new Date("2026-11-07T22:00:00.000Z");
/** Tuesday 1 Dec 06:00 in Manila. */
const NEXT_MONTH = new Date("2026-11-30T22:00:00.000Z");
const H = 3600;

let cast: TimeOffCast;
let siteId: string;

const time = (hours: number, extra: Partial<EstimateInput> = {}): EstimateInput => ({
  kind: "TIME",
  seconds: hours * H,
  minor: null,
  reset: "NONE",
  alerts: true,
  ...extra,
});

async function work(projectId: string, startIso: string, hours: number) {
  const start = new Date(startIso);
  await createManualEntry(
    db,
    await cast.viewer("bob"),
    {
      description: "Work",
      projectId,
      taskId: null,
      tagIds: [],
      billable: false,
      start,
      end: new Date(start.getTime() + hours * H * 1000),
    },
    NOW,
  );
}

/** Outbox rows of budget alerts as "kind → address", sorted. */
async function alerts(): Promise<string[]> {
  const rows = await db
    .select({ kind: emailOutbox.kind, to: emailOutbox.toAddress, subject: emailOutbox.subject })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.workspaceId, cast.wsId), like(emailOutbox.kind, "budget:%")));
  return rows.map((r) => `${r.kind} → ${r.to}`).sort();
}

async function emailOf(who: keyof TimeOffCast["ids"]) {
  const u = await db.query.user.findFirst({ where: (t, { eq: e }) => e(t.id, cast.ids[who]) });
  return u!.email;
}

const run = (now = NOW) => runDailyJobs(db, { now, workspaceIds: [cast.wsId] });

beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
  const owner = await cast.viewer("olga");
  siteId = (await createProject(db, owner, { name: "Site" })).id;
});

describe("budget alerts", () => {
  it("fires once per threshold, project and period over repeated runs", async () => {
    await setProjectEstimate(db, await cast.viewer("olga"), siteId, time(2));
    await work(siteId, "2026-11-06T02:00:00Z", 1);
    const first = await run();
    expect(first.budgets).toBe(2); // 50%: Olga and Ann
    const olga = await emailOf("olga");
    const ann = await emailOf("ann");
    expect(await alerts()).toEqual(
      [`budget:${siteId}:50:all → ${olga}`, `budget:${siteId}:50:all → ${ann}`].sort(),
    );
    expect((await run()).budgets).toBe(0);

    await work(siteId, "2026-11-06T04:00:00Z", 1);
    expect((await run()).budgets).toBe(4); // 80 and 100, once each, to both
    expect((await alerts()).filter((a) => a.includes(":100:all"))).toHaveLength(2);
    expect((await run()).budgets).toBe(0);

    const [row] = await db
      .select({ subject: emailOutbox.subject })
      .from(emailOutbox)
      .where(eq(emailOutbox.kind, `budget:${siteId}:100:all`))
      .limit(1);
    expect(row?.subject).toBe("Site has used 100% of its estimate");
  });

  it("a monthly estimate restarts next month", async () => {
    await setProjectEstimate(db, await cast.viewer("olga"), siteId, time(2, { reset: "MONTHLY" }));
    await work(siteId, "2026-11-06T02:00:00Z", 1);
    expect((await run()).budgets).toBe(2);
    expect((await alerts()).every((a) => a.includes(":50:2026-11 →"))).toBe(true);
    // December: nothing tracked yet, so nothing crosses; then an hour does, under the new key.
    expect((await run(NEXT_MONTH)).budgets).toBe(0);
    await work(siteId, "2026-11-30T23:00:00Z", 1);
    expect((await run(NEXT_MONTH)).budgets).toBe(2);
    expect((await alerts()).filter((a) => a.includes(":50:2026-12 →"))).toHaveLength(2);
  });

  it("recipients are owners, admins and the project's managers, never a plain member", async () => {
    await db.insert(projectMember).values([
      { projectId: siteId, userId: cast.ids.max, isManager: true },
      { projectId: siteId, userId: cast.ids.bob },
    ]);
    await setProjectEstimate(db, await cast.viewer("olga"), siteId, time(1));
    await work(siteId, "2026-11-06T02:00:00Z", 1);
    await run();
    const to = (await alerts()).map((a) => a.split(" → ")[1]);
    expect(new Set(to)).toEqual(
      new Set([await emailOf("olga"), await emailOf("ann"), await emailOf("max")]),
    );
    expect(to).not.toContain(await emailOf("bob"));
  });

  it("alerts off, an archived project and a template send nothing", async () => {
    const owner = await cast.viewer("olga");
    const quiet = (await createProject(db, owner, { name: "Quiet" })).id;
    const old = (await createProject(db, owner, { name: "Old" })).id;
    const tpl = (await createProject(db, owner, { name: "Template" })).id;
    for (const id of [quiet, old, tpl]) {
      await setProjectEstimate(db, owner, id, time(1, { alerts: id !== quiet }));
      await work(id, "2026-11-06T02:00:00Z", 2);
    }
    await db.update(project).set({ archived: true }).where(eq(project.id, old));
    await db.update(project).set({ isTemplate: true }).where(eq(project.id, tpl));
    expect((await run()).budgets).toBe(0);
    expect(await alerts()).toEqual([]);
  });

  it("runDailyJobs picks up a workspace with only an estimate and counts budgets", async () => {
    // Approval is off and there is no target rule: the estimate alone brings the workspace in.
    await setProjectEstimate(db, await cast.viewer("olga"), siteId, time(1));
    await work(siteId, "2026-11-06T02:00:00Z", 1);
    // One hour of one: 50, 80 and 100 crossed at once, to Olga and Ann.
    expect(await run()).toEqual({ reminders: 0, targets: 0, budgets: 6 });
  });
});
