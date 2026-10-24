import { randomUUID } from "node:crypto";

import { eq, exportJob, reportShareLink } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";

const handle = connectTestDb();
const db = handle.db;

function pgCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return typeof cause === "object" && cause !== null ? (cause as { code?: string }).code : undefined;
}

describe("report share links and export jobs", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());
  beforeEach(async () => truncateAll(db));

  it("stores a share link whose token hash is unique, with its query and preferences", async () => {
    const alice = await createTestUser(db, "Alice A");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    const tokenHash = "a".repeat(64);
    const values = {
      workspaceId: ws.id,
      createdBy: alice.id,
      tokenHash,
      kind: "summary" as const,
      query: { preset: "this-week", groupBy: ["project"] },
      prefs: { timezone: "Asia/Manila", weekStart: 1 },
      title: "This week",
    };
    await db.insert(reportShareLink).values({ id: randomUUID(), ...values });
    const duplicate = db.insert(reportShareLink).values({ id: randomUUID(), ...values });
    await expect(duplicate).rejects.toThrow();
    await duplicate.catch((error: unknown) => expect(pgCode(error)).toBe("23505"));

    const [row] = await db
      .select()
      .from(reportShareLink)
      .where(eq(reportShareLink.tokenHash, tokenHash));
    expect(row).toMatchObject({
      kind: "summary",
      query: { preset: "this-week", groupBy: ["project"] },
      prefs: { timezone: "Asia/Manila", weekStart: 1 },
      openCount: 0,
      expiresAt: null,
      revokedAt: null,
    });
  });

  it("stores an export job that starts queued", async () => {
    const alice = await createTestUser(db, "Alice A");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    const [job] = await db
      .insert(exportJob)
      .values({
        id: randomUUID(),
        workspaceId: ws.id,
        userId: alice.id,
        format: "csv",
        report: "summary",
        query: { preset: "last-month" },
        expiresAt: new Date("2026-11-01T00:00:00.000Z"),
      })
      .returning();
    expect(job).toMatchObject({
      status: "queued",
      rowCount: null,
      objectKey: null,
      error: null,
      finishedAt: null,
    });
  });
});
