import { randomUUID } from "node:crypto";

import { eq, exportJob } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import { routeParams } from "../../test/route-env";
import type { AuthSession } from "./auth";
import type * as ReportFiles from "./report-files";
import type * as Reports from "./reports";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
});

const session = vi.hoisted(() => ({ current: null as AuthSession | null }));
vi.mock("./session", () => ({ getSession: async () => session.current }));

const failures = vi.hoisted(() => ({ summary: null as Error | null, bigFile: false }));
vi.mock("./reports", async (original) => {
  const real = await original<typeof Reports>();
  return {
    ...real,
    summaryReport: (...args: Parameters<typeof real.summaryReport>) => {
      if (failures.summary) return Promise.reject(failures.summary);
      return real.summaryReport(...args);
    },
  };
});
vi.mock("./report-files", async (original) => {
  const real = await original<typeof ReportFiles>();
  return {
    ...real,
    buildExport: async (...args: Parameters<typeof real.buildExport>) => {
      const file = await real.buildExport(...args);
      // A file just over the 4 MB a streamed response may carry.
      return failures.bigFile ? { ...file, body: new Uint8Array(4 * 1024 * 1024 + 1) } : file;
    },
  };
});
vi.mock("next/server", async (original) => ({
  ...(await original<object>()),
  after: () => undefined,
}));

const { GET: detailedGET } = await import("@/app/api/w/[workspaceSlug]/reports/detailed/route");
const { GET: summaryGET } = await import("@/app/api/w/[workspaceSlug]/reports/summary/route");
const { GET: exportGET } = await import("@/app/api/w/[workspaceSlug]/reports/export/route");
const { createManualEntry } = await import("./time-entries");

const handle = connectTestDb();
const db = handle.db;
let slug: string;
let workspaceId: string;

const url = (path: string) => new Request(`http://localhost/api/w/${slug}/reports/${path}`);
const ctx = () => routeParams({ workspaceSlug: slug });

describe("report routes", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    failures.summary = null;
    failures.bigFile = false;
    const alice = await createTestUser(db, "Alice A");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    slug = ws.slug;
    workspaceId = ws.id;
    session.current = {
      user: alice,
      session: { id: randomUUID(), userId: alice.id },
    } as unknown as AuthSession;
    await createManualEntry(db, asViewer({ workspaceId, userId: alice.id, role: "owner" }), {
      description: "Site work",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
      start: new Date(Date.now() - 2 * 3_600_000),
      end: new Date(Date.now() - 3_600_000),
    });
  });

  it("answers a malformed Detailed cursor with 400, not a database error", async () => {
    const id = randomUUID();
    const bad = await detailedGET(url(`detailed?cursorValue=not-a-date&cursorId=${id}`), ctx());
    expect(bad.status).toBe(400);
    const badNumber = await detailedGET(
      url(`detailed?sort=duration&cursorValue=12abc&cursorId=${id}`),
      ctx(),
    );
    expect(badNumber.status).toBe(400);

    const good = await detailedGET(
      url(`detailed?cursorValue=${encodeURIComponent(new Date().toISOString())}&cursorId=${id}`),
      ctx(),
    );
    expect(good.status).toBe(200);
    const byDuration = await detailedGET(
      url(`detailed?sort=duration&dir=asc&cursorValue=0&cursorId=${id}`),
      ctx(),
    );
    expect(byDuration.status).toBe(200);
  });

  it("logs an unexpected failure before answering 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      failures.summary = new Error("connection lost");
      const res = await summaryGET(url("summary"), ctx());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Something went wrong." });
      expect(log).toHaveBeenCalledWith(expect.any(String), failures.summary);
    } finally {
      log.mockRestore();
    }
  });

  it("an export too large to stream becomes a job", async () => {
    const small = await exportGET(url("export?report=detailed&format=csv"), ctx());
    expect(small.status).toBe(200);
    expect(await db.select().from(exportJob)).toHaveLength(0);

    failures.bigFile = true;
    const big = await exportGET(url("export?report=detailed&format=csv"), ctx());
    expect(big.status).toBe(202);
    const { jobId } = (await big.json()) as { jobId: string };
    const [job] = await db.select().from(exportJob).where(eq(exportJob.id, jobId));
    expect(job).toMatchObject({ workspaceId, status: "queued", report: "detailed" });
  });

  it("logs an unexpected export failure before answering 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      failures.summary = new Error("connection lost");
      const res = await exportGET(url("export?report=summary&format=csv"), ctx());
      expect(res.status).toBe(500);
      expect(log).toHaveBeenCalledWith(expect.any(String), failures.summary);
    } finally {
      log.mockRestore();
    }
  });
});
