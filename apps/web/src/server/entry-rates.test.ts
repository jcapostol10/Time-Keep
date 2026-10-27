import { randomUUID } from "node:crypto";

import { eq, rate, timeEntry } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import {
  continueEntry,
  createManualEntry,
  duplicateEntry,
  reassignProjectEntries,
  startTimer,
  stopTimer,
  updateEntry,
} from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const JAN = new Date("2026-01-01T00:00:00Z");
const START = new Date("2026-03-02T01:00:00Z");
const NOW = new Date("2026-03-11T04:00:00Z");
const H = 3_600_000;

let me: Viewer;
let web: string;
let app: string;

async function addRate(over: {
  level: "workspace" | "project";
  projectId?: string;
  amountMinor: number;
  effectiveFrom?: Date;
}) {
  await db.insert(rate).values({
    id: randomUUID(),
    workspaceId: me.workspaceId,
    level: over.level,
    projectId: over.projectId ?? null,
    amountMinor: over.amountMinor,
    currency: "USD",
    effectiveFrom: over.effectiveFrom ?? JAN,
  });
}

async function stored(id: string) {
  const [row] = await db
    .select({
      rate: timeEntry.billableRateMinor,
      currency: timeEntry.rateCurrency,
      source: timeEntry.rateSource,
      amount: timeEntry.amountMinor,
    })
    .from(timeEntry)
    .where(eq(timeEntry.id, id));
  return row;
}

const details = (over: { projectId?: string | null; billable?: boolean } = {}) => ({
  description: "Work",
  projectId: over.projectId === undefined ? web : over.projectId,
  taskId: null,
  tagIds: [],
  billable: over.billable ?? true,
});

describe("entries are rated as they are saved", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    me = await loadViewer(db, ws.id, olga.id);
    web = (await createProject(db, me, { name: "Web" })).id;
    app = (await createProject(db, me, { name: "App" })).id;
    await addRate({ level: "workspace", amountMinor: 5000 });
    await addRate({ level: "project", projectId: web, amountMinor: 8000 });
  });

  it("gives a manual entry the project's rate and its amount", async () => {
    const e = await createManualEntry(db, me, {
      ...details(),
      start: START,
      end: new Date(START.getTime() + 1.5 * H),
    });
    expect(await stored(e.id)).toEqual({
      rate: 8000,
      currency: "USD",
      source: "project",
      amount: 12000,
    });
  });

  it("rates a timer when it starts and sets its amount when it stops", async () => {
    const { started } = await startTimer(db, me, details(), START);
    expect(await stored(started.id)).toMatchObject({ rate: 8000, amount: null });
    await stopTimer(db, me, { entryId: started.id, end: new Date(START.getTime() + 0.5 * H) }, NOW);
    expect(await stored(started.id)).toMatchObject({ rate: 8000, amount: 4000 });
  });

  it("keeps an entry's rate when its description or duration changes, recomputing the amount", async () => {
    const e = await createManualEntry(db, me, {
      ...details(),
      start: START,
      end: new Date(START.getTime() + H),
    });
    // A backdated change to Web's rate, after the entry was saved.
    await addRate({
      level: "project",
      projectId: web,
      amountMinor: 9000,
      effectiveFrom: new Date("2026-02-01T00:00:00Z"),
    });

    await updateEntry(db, me, e.id, { description: "Renamed" }, NOW);
    expect(await stored(e.id)).toMatchObject({ rate: 8000, amount: 8000 });
    await updateEntry(db, me, e.id, { end: new Date(START.getTime() + 2 * H) }, NOW);
    expect(await stored(e.id)).toMatchObject({ rate: 8000, amount: 16000 });
  });

  it("re-rates when the project changes or billable is switched on", async () => {
    const e = await createManualEntry(db, me, {
      ...details({ billable: false }),
      start: START,
      end: new Date(START.getTime() + H),
    });
    await addRate({
      level: "project",
      projectId: web,
      amountMinor: 9000,
      effectiveFrom: new Date("2026-02-01T00:00:00Z"),
    });
    await updateEntry(db, me, e.id, { billable: true }, NOW);
    expect(await stored(e.id)).toMatchObject({ rate: 9000, source: "project", amount: 9000 });

    await updateEntry(db, me, e.id, { projectId: app }, NOW);
    expect(await stored(e.id)).toMatchObject({ rate: 5000, source: "workspace", amount: 5000 });
  });

  it("rates a duplicate by its own start and a continued entry by today's rates", async () => {
    const e = await createManualEntry(db, me, {
      ...details(),
      start: START,
      end: new Date(START.getTime() + H),
    });
    await addRate({
      level: "project",
      projectId: web,
      amountMinor: 11000,
      effectiveFrom: new Date("2026-03-10T00:00:00Z"),
    });

    const copy = await duplicateEntry(db, me, e.id);
    expect(await stored(copy.id)).toMatchObject({ rate: 8000, amount: 8000 });
    const { started } = await continueEntry(db, me, e.id, NOW);
    expect(await stored(started.id)).toMatchObject({ rate: 11000, amount: null });
  });

  it("re-rates entries moved to another project", async () => {
    const e = await createManualEntry(db, me, {
      ...details(),
      start: START,
      end: new Date(START.getTime() + H),
    });
    await reassignProjectEntries(db, me.workspaceId, web, app);
    expect(await stored(e.id)).toMatchObject({ rate: 5000, source: "workspace", amount: 5000 });
  });
});
