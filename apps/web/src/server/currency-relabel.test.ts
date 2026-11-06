import { randomUUID } from "node:crypto";

import {
  client,
  eq,
  project,
  projectMember,
  rate,
  timeEntry,
  workspaceSettings,
} from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import { createClient, updateClient } from "./catalog/clients";
import { createProject, updateProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { relabelWorkspaceCurrency } from "./rates";
import { createManualEntry } from "./time-entries";

// Phase 6a, decision 8: a currency change relabels, after a confirmation, and
// never converts. Each change touches only what took the currency that changed.

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let owner: Viewer;
let manager: Viewer;
/** Clients and projects by name. */
let ids: Record<string, string>;
/** One entry per project name ("Loose" has no project). */
let entryOf: Record<string, string>;

const JAN = new Date("2026-01-01T00:00:00Z");
const START = new Date("2026-03-02T01:00:00Z");

async function addRate(over: Partial<typeof rate.$inferInsert> & { amountMinor: number }) {
  await db.insert(rate).values({
    id: randomUUID(),
    workspaceId: wsId,
    level: "workspace",
    currency: "PHP",
    effectiveFrom: JAN,
    ...over,
  });
}

/** Every rate row as "kind level project currency amount", sorted. */
async function rates(): Promise<string[]> {
  const nameOf = new Map(Object.entries(ids).map(([name, id]) => [id, name]));
  const rows = await db.select().from(rate).where(eq(rate.workspaceId, wsId));
  return rows
    .map(
      (r) =>
        `${r.kind} ${r.level} ${r.projectId ? nameOf.get(r.projectId) : "-"} ${r.currency} ${r.amountMinor}`,
    )
    .sort();
}

/** Each entry's billable snapshot: [currency, rate, amount]. */
async function entries(): Promise<Record<string, [string | null, number | null, number | null]>> {
  const labelOf = new Map(Object.entries(entryOf).map(([name, id]) => [id, name]));
  const rows = await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, wsId));
  return Object.fromEntries(
    rows.map((e) => [labelOf.get(e.id)!, [e.rateCurrency, e.billableRateMinor, e.amountMinor]]),
  );
}

const BEFORE_RATES = [
  "billable member - PHP 250000",
  "billable project Eu EUR 3000",
  "billable project Ph PHP 90000",
  "billable project Us USD 4000",
  "billable project_member Us USD 5000",
  "billable workspace - PHP 100000",
  "cost member - PHP 60000",
  "cost project_member Us PHP 70000",
];
const BEFORE_ENTRIES = {
  Us: ["USD", 5000, 5000],
  // Billed in USD with no rate in USD: unrated, never ₱2,500 read as $2,500.
  Us2: [null, null, null],
  Eu: ["EUR", 3000, 3000],
  Home: ["PHP", 250_000, 250_000],
  Loose: ["PHP", 250_000, 250_000],
  Ph: ["PHP", 90_000, 90_000],
};

describe("currency relabels", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, max.id, "manager");
    await db
      .update(workspaceSettings)
      .set({ currency: "PHP" })
      .where(eq(workspaceSettings.workspaceId, ws.id));
    owner = await loadViewer(db, ws.id, olga.id);

    ids = {};
    const clients: [string, string | null][] = [
      ["Acme", "USD"],
      ["Globex", "EUR"],
      // No currency of its own: it follows the workspace.
      ["Local", null],
      // The workspace's code, chosen on purpose: it does not follow the workspace.
      ["Explicit", "PHP"],
    ];
    for (const [name, currency] of clients) {
      ids[name] = randomUUID();
      await db.insert(client).values({ id: ids[name], workspaceId: ws.id, name, currency });
    }
    const projects: [string, string][] = [
      ["Us", "Acme"],
      ["Us2", "Acme"],
      ["Eu", "Globex"],
      ["Home", "Local"],
      ["Ph", "Explicit"],
    ];
    for (const [name, clientName] of projects) {
      ids[name] = (await createProject(db, owner, { name })).id;
      await db.update(project).set({ clientId: ids[clientName] }).where(eq(project.id, ids[name]!));
    }
    await db.insert(projectMember).values({ projectId: ids.Us!, userId: max.id, isManager: true });
    manager = await loadViewer(db, ws.id, max.id);

    await addRate({ amountMinor: 100_000 });
    await addRate({ level: "member", userId: olga.id, amountMinor: 250_000 });
    await addRate({ kind: "cost", level: "member", userId: olga.id, amountMinor: 60_000 });
    await addRate({ level: "project", projectId: ids.Us!, currency: "USD", amountMinor: 4000 });
    await addRate({
      level: "project_member",
      projectId: ids.Us!,
      userId: olga.id,
      currency: "USD",
      amountMinor: 5000,
    });
    await addRate({
      kind: "cost",
      level: "project_member",
      projectId: ids.Us!,
      userId: olga.id,
      amountMinor: 70_000,
    });
    await addRate({ level: "project", projectId: ids.Eu!, currency: "EUR", amountMinor: 3000 });
    await addRate({ level: "project", projectId: ids.Ph!, amountMinor: 90_000 });

    entryOf = {};
    for (const name of ["Us", "Us2", "Eu", "Home", "Ph", "Loose"]) {
      const e = await createManualEntry(db, owner, {
        description: name,
        projectId: ids[name] ?? null,
        taskId: null,
        tagIds: [],
        billable: true,
        start: START,
        end: new Date(START.getTime() + 3_600_000),
      });
      entryOf[name] = e.id;
    }
    expect(await rates()).toEqual(BEFORE_RATES);
    expect(await entries()).toEqual(BEFORE_ENTRIES);
  });

  it("changing a client's currency relabels its projects' rates and entries only", async () => {
    await expect(updateClient(db, wsId, ids.Acme!, { currency: "GBP" })).rejects.toMatchObject({
      code: "CONFIRM",
      message:
        "Rates and amounts on this client's projects will show in GBP; they are not converted.",
    });
    // Refused: nothing changed, the client included.
    expect((await db.select().from(client).where(eq(client.id, ids.Acme!)))[0]?.currency).toBe(
      "USD",
    );
    expect(await rates()).toEqual(BEFORE_RATES);

    const updated = await updateClient(
      db,
      wsId,
      ids.Acme!,
      { currency: "GBP" },
      { confirmCurrencyChange: true },
    );
    expect(updated.currency).toBe("GBP");
    // The same numbers under the new code; the cost on the project stays the workspace's.
    expect(await rates()).toEqual(
      [
        "billable member - PHP 250000",
        "billable project Eu EUR 3000",
        "billable project Ph PHP 90000",
        "billable project Us GBP 4000",
        "billable project_member Us GBP 5000",
        "billable workspace - PHP 100000",
        "cost member - PHP 60000",
        "cost project_member Us PHP 70000",
      ].sort(),
    );
    expect(await entries()).toEqual({ ...BEFORE_ENTRIES, Us: ["GBP", 5000, 5000] });

    // No currency of its own again: the client follows the workspace, after a confirmation.
    await expect(updateClient(db, wsId, ids.Acme!, { currency: null })).rejects.toMatchObject({
      code: "CONFIRM",
      message:
        "Rates and amounts on this client's projects will show in PHP; they are not converted.",
    });
    await updateClient(db, wsId, ids.Acme!, { currency: null }, { confirmCurrencyChange: true });
    expect((await entries()).Us).toEqual(["PHP", 5000, 5000]);
    expect((await rates()).filter((r) => r.includes(" Us "))).toEqual([
      "billable project Us PHP 4000",
      "billable project_member Us PHP 5000",
      "cost project_member Us PHP 70000",
    ]);
  });

  it("asks for no confirmation when a client's change relabels nothing", async () => {
    // The workspace's code in place of "follows the workspace": the same currency.
    await updateClient(db, wsId, ids.Local!, { currency: "PHP" });
    // A client whose projects have no rates and no rated entries.
    const fresh = await createClient(db, wsId, {
      name: "Fresh",
      address: "",
      email: "",
      notes: "",
      currency: null,
    });
    const quiet = await createProject(db, owner, { name: "Quiet" });
    await db.update(project).set({ clientId: fresh.id }).where(eq(project.id, quiet.id));
    expect((await updateClient(db, wsId, fresh.id, { currency: "USD" })).currency).toBe("USD");
    // Other fields never ask.
    await updateClient(db, wsId, ids.Acme!, { notes: "Net 30" });
    expect(await rates()).toEqual(BEFORE_RATES);
    expect(await entries()).toEqual(BEFORE_ENTRIES);
  });

  it("moving a project to a client in another currency relabels the project", async () => {
    await expect(
      updateProject(db, owner, ids.Us!, { clientId: ids.Globex! }),
    ).rejects.toMatchObject({
      code: "CONFIRM",
      message: "This project's rates and amounts will show in EUR; they are not converted.",
    });
    expect(await rates()).toEqual(BEFORE_RATES);

    await updateProject(
      db,
      owner,
      ids.Us!,
      { clientId: ids.Globex! },
      { confirmCurrencyChange: true },
    );
    expect((await rates()).filter((r) => r.includes(" Us "))).toEqual([
      "billable project Us EUR 4000",
      "billable project_member Us EUR 5000",
      "cost project_member Us PHP 70000",
    ]);
    // The client's other project and everything else are untouched.
    expect(await entries()).toEqual({ ...BEFORE_ENTRIES, Us: ["EUR", 5000, 5000] });

    // A project with no rates of its own, but time rated by the member's: the entries move.
    await updateProject(
      db,
      owner,
      ids.Home!,
      { clientId: ids.Acme! },
      { confirmCurrencyChange: true },
    );
    expect((await entries()).Home).toEqual(["USD", 250_000, 250_000]);
    // Off a client altogether: back to the workspace's currency, asked again.
    await expect(updateProject(db, owner, ids.Home!, { clientId: null })).rejects.toMatchObject({
      code: "CONFIRM",
    });

    // The same currency on both sides: nothing to confirm.
    await updateProject(db, owner, ids.Ph!, { clientId: ids.Local! });
    expect((await entries()).Ph).toEqual(["PHP", 90_000, 90_000]);
  });

  it("lets only owners and admins move a project when that relabels its rates", async () => {
    await expect(
      updateProject(
        db,
        manager,
        ids.Us!,
        { clientId: ids.Globex! },
        { confirmCurrencyChange: true },
      ),
    ).rejects.toThrow(
      "Only owners and admins can move a project with rates to a client billed in another currency.",
    );
    expect(await rates()).toEqual(BEFORE_RATES);
    // The project's manager still edits the rest.
    expect((await updateProject(db, manager, ids.Us!, { name: "United States" })).name).toBe(
      "United States",
    );
  });

  it("changing the workspace currency leaves a USD client's entries in USD", async () => {
    await db.transaction((tx) => relabelWorkspaceCurrency(tx, wsId, "PHP", "SGD"));
    expect(await rates()).toEqual(
      [
        "billable member - SGD 250000",
        "billable project Eu EUR 3000",
        // A client that chose PHP keeps PHP.
        "billable project Ph PHP 90000",
        "billable project Us USD 4000",
        "billable project_member Us USD 5000",
        "billable workspace - SGD 100000",
        "cost member - SGD 60000",
        // Cost is always the workspace's, on any project.
        "cost project_member Us SGD 70000",
      ].sort(),
    );
    expect(await entries()).toEqual({
      ...BEFORE_ENTRIES,
      Home: ["SGD", 250_000, 250_000],
      Loose: ["SGD", 250_000, 250_000],
    });
  });
});
