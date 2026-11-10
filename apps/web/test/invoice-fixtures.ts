import { randomUUID } from "node:crypto";

import { type ViewerPrefs, zonedDateTimeToInstant } from "@timekeep/core";
import { type Database, eq, rate, workspaceSettings } from "@timekeep/db";

import { loadViewer, scopeForUser } from "../src/server/authz";
import { createClient } from "../src/server/catalog/clients";
import { createProject } from "../src/server/catalog/projects";
import type { Viewer } from "../src/server/catalog/viewer";
import { createManualEntry, type EntryScope } from "../src/server/time-entries";
import { addMember, createTestUser, createTestWorkspace, truncateAll } from "./db";

/**
 * The Phase 6d fixture: a PHP workspace in Manila rounding up to 15 minutes,
 * ₱1,000/h for everyone from Monday 10:00, client Acme (PHP) with projects Web
 * and App, client Globex (USD) with project Portal priced at $40/h, and five
 * people. Entries are the tests' own.
 */

export const TZ = "Asia/Manila";
/** Wednesday 28 Oct 2026 12:00 Manila. */
export const NOW = new Date("2026-10-28T04:00:00.000Z");
export const PREFS: ViewerPrefs = {
  timezone: TZ,
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
export const WEEK = { from: "2026-10-26", to: "2026-11-01" };

export const at = (date: string, hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return zonedDateTimeToInstant({ date, hours: h, minutes: m }, TZ);
};

export interface InvoiceFixture {
  wsId: string;
  ids: Record<string, string>;
  acmeId: string;
  globexId: string;
  webId: string;
  appId: string;
  portalId: string;
  viewer: (who: string) => Promise<Viewer>;
  as: (who: string, target?: string) => Promise<EntryScope>;
  entry: (
    who: string,
    over: {
      start: Date;
      minutes: number;
      billable?: boolean;
      projectId?: string;
      description?: string;
    },
  ) => Promise<{ id: string }>;
}

export async function setUpInvoiceFixture(db: Database): Promise<InvoiceFixture> {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const ann = await createTestUser(db, "Ann Admin");
  const max = await createTestUser(db, "Max Manager");
  const bob = await createTestUser(db, "Bob Member");
  const carol = await createTestUser(db, "Carol Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  const wsId = ws.id;
  const ids = { olga: olga.id, ann: ann.id, max: max.id, bob: bob.id, carol: carol.id };
  await addMember(db, wsId, ann.id, "admin");
  await addMember(db, wsId, max.id, "manager");
  await addMember(db, wsId, bob.id, "member");
  await addMember(db, wsId, carol.id, "member");
  await db
    .update(workspaceSettings)
    .set({
      timezone: TZ,
      weekStart: 1,
      currency: "PHP",
      roundingMode: "up",
      roundingMinutes: 15,
    })
    .where(eq(workspaceSettings.workspaceId, wsId));
  const blank = { address: "", notes: "" };
  const acmeId = (
    await createClient(db, wsId, {
      name: "Acme",
      email: "billing@acme.test",
      currency: null,
      ...blank,
    })
  ).id;
  const globexId = (
    await createClient(db, wsId, { name: "Globex", email: "", currency: "USD", ...blank })
  ).id;
  const owner = await loadViewer(db, wsId, olga.id);
  const webId = (await createProject(db, owner, { name: "Web", clientId: acmeId })).id;
  const appId = (await createProject(db, owner, { name: "App", clientId: acmeId })).id;
  const portalId = (await createProject(db, owner, { name: "Portal", clientId: globexId })).id;
  await db.insert(rate).values([
    {
      id: randomUUID(),
      workspaceId: wsId,
      level: "workspace",
      amountMinor: 100_000,
      currency: "PHP",
      effectiveFrom: at("2026-10-26", "10:00"),
    },
    {
      id: randomUUID(),
      workspaceId: wsId,
      level: "project",
      projectId: portalId,
      amountMinor: 4_000,
      currency: "USD",
      effectiveFrom: at("2026-10-26", "10:00"),
    },
  ]);

  const viewer = (who: string) => loadViewer(db, wsId, ids[who as keyof typeof ids]!);
  const as = async (who: string, target = who) =>
    scopeForUser(db, await viewer(who), ids[target as keyof typeof ids]!);
  const entry: InvoiceFixture["entry"] = async (who, over) =>
    createManualEntry(
      db,
      await as(who),
      {
        description: over.description ?? "Work",
        projectId: over.projectId ?? webId,
        taskId: null,
        tagIds: [],
        billable: over.billable ?? true,
        start: over.start,
        end: new Date(over.start.getTime() + over.minutes * 60_000),
      },
      NOW,
    );
  return { wsId, ids, acmeId, globexId, webId, appId, portalId, viewer, as, entry };
}
