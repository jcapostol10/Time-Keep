import { DEFAULT_REPORT_QUERY, type ViewerPrefs } from "@timekeep/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import { routeParams } from "../../test/route-env";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
  // Two entries are "too large" here; production keeps 10,000.
  process.env.EXPORT_JOB_THRESHOLD = "1";
});

const { GET } = await import("@/app/share/[token]/export/route");
const { createShareLink } = await import("./share-links");
const { createManualEntry } = await import("./time-entries");

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};

describe("the shared report's export", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());
  beforeEach(async () => truncateAll(db));

  it("refuses a report over the job threshold with 413, since no one could own the job", async () => {
    const alice = await createTestUser(db, "Alice A");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    const viewer = asViewer({ workspaceId: ws.id, userId: alice.id, role: "owner" });
    const share = (title: string) =>
      createShareLink(
        db,
        viewer,
        {
          kind: "detailed",
          query: {
            ...DEFAULT_REPORT_QUERY,
            preset: "custom",
            from: new Date(Date.now() - 24 * 3_600_000).toISOString(),
            to: new Date(Date.now() + 3_600_000).toISOString(),
          },
          title,
        },
        PREFS,
      );
    const download = async (token: string) =>
      GET(new Request(`http://localhost/share/${token}/export?format=csv`), routeParams({ token }));
    const add = (description: string, hoursAgo: number) =>
      createManualEntry(db, viewer, {
        description,
        projectId: null,
        taskId: null,
        tagIds: [],
        billable: false,
        start: new Date(Date.now() - hoursAgo * 3_600_000),
        end: new Date(Date.now() - (hoursAgo - 0.5) * 3_600_000),
      });

    await add("Site work", 1);
    const small = await share("One entry");
    expect((await download(small.token)).status).toBe(200);

    await add("Email", 2);
    const large = await share("Two entries");
    const res = await download(large.token);
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/too large to download from a shared link/);
  });
});
