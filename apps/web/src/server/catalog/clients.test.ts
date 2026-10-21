import type { ClientInput } from "@timekeep/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../../test/db";
import { createClient, deleteClient, listClientOptions, listClients, updateClient } from "./clients";
import { createProject } from "./projects";
import type { Viewer } from "./viewer";

const handle = connectTestDb();
const db = handle.db;

const input = (name: string, over: Partial<ClientInput> = {}): ClientInput => ({
  name,
  address: "",
  email: "",
  notes: "",
  currency: null,
  ...over,
});

let viewer: Viewer;
let other: Viewer;

describe("clients service", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const alice = await createTestUser(db, "Alice A");
    const bob = await createTestUser(db, "Bob B");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    const wsB = await createTestWorkspace(db, "Workspace B", bob.id);
    viewer = { workspaceId: ws.id, userId: alice.id, role: "owner" };
    other = { workspaceId: wsB.id, userId: bob.id, role: "owner" };
  });

  it("creates with defaults and lists with project counts", async () => {
    const acme = await createClient(db, viewer.workspaceId, input(" Acme ", { email: "a@b.co" }));
    expect(acme).toMatchObject({
      name: "Acme",
      address: "",
      email: "a@b.co",
      notes: "",
      currency: null,
      archived: false,
      projectCount: 0,
    });
    await createProject(db, viewer, { name: "Site", clientId: acme.id });
    await createProject(db, viewer, { name: "App", clientId: acme.id });
    await createClient(db, viewer.workspaceId, input("Globex"));

    const rows = await listClients(db, viewer.workspaceId, {});
    expect(rows.map((c) => [c.name, c.projectCount])).toEqual([
      ["Acme", 2],
      ["Globex", 0],
    ]);
    expect(await listClients(db, other.workspaceId, {})).toEqual([]);
  });

  it("filters by search and status", async () => {
    const acme = await createClient(db, viewer.workspaceId, input("Acme"));
    await createClient(db, viewer.workspaceId, input("Globex"));
    await updateClient(db, viewer.workspaceId, acme.id, { archived: true });

    const names = async (o: Parameters<typeof listClients>[2]) =>
      (await listClients(db, viewer.workspaceId, o)).map((c) => c.name);
    expect(await names({})).toEqual(["Globex"]);
    expect(await names({ status: "archived" })).toEqual(["Acme"]);
    expect(await names({ status: "all" })).toEqual(["Acme", "Globex"]);
    expect(await names({ status: "all", q: "glo" })).toEqual(["Globex"]);
    expect(await names({ status: "all", q: "ACME" })).toEqual(["Acme"]);
    expect(await listClientOptions(db, viewer.workspaceId)).toEqual([
      { id: acme.id, name: "Acme", archived: true },
      expect.objectContaining({ name: "Globex", archived: false }),
    ]);
  });

  it("rejects a duplicate name", async () => {
    await createClient(db, viewer.workspaceId, input("Acme"));
    await expect(createClient(db, viewer.workspaceId, input("Acme"))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A client with this name already exists.",
    });
    // Another workspace may use the same name.
    await expect(createClient(db, other.workspaceId, input("Acme"))).resolves.toMatchObject({
      name: "Acme",
    });
  });

  it("updates fields and archives", async () => {
    const acme = await createClient(db, viewer.workspaceId, input("Acme"));
    const updated = await updateClient(db, viewer.workspaceId, acme.id, {
      name: "Acme Corp",
      notes: "Net 30",
      currency: "PHP",
      archived: true,
    });
    expect(updated).toMatchObject({ name: "Acme Corp", notes: "Net 30", currency: "PHP", archived: true });
    await expect(updateClient(db, other.workspaceId, acme.id, { name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes only an unused client", async () => {
    const acme = await createClient(db, viewer.workspaceId, input("Acme"));
    await createProject(db, viewer, { name: "Site", clientId: acme.id });
    await expect(deleteClient(db, viewer.workspaceId, acme.id)).rejects.toMatchObject({
      code: "IN_USE",
      message: "Move or delete its projects first.",
    });

    const globex = await createClient(db, viewer.workspaceId, input("Globex"));
    await deleteClient(db, viewer.workspaceId, globex.id);
    expect((await listClients(db, viewer.workspaceId, {})).map((c) => c.name)).toEqual(["Acme"]);
    await expect(deleteClient(db, other.workspaceId, acme.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
