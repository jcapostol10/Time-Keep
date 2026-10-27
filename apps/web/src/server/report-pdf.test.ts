import { existsSync } from "node:fs";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { buildPdfExport, localChromePath, renderReportHtml } from "./report-pdf";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const QUERY: ReportQuery = {
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
};
const NOW = new Date("2026-03-11T04:00:00.000Z");

let viewer: Viewer;

describe("PDF export", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const alice = await createTestUser(db, "Alice A");
    const ws = await createTestWorkspace(db, "Acme <Ops>", alice.id);
    viewer = asViewer({ workspaceId: ws.id, userId: alice.id, role: "owner" });
    const web = await createProject(db, viewer, { name: "Web & <Apps>" });
    await createManualEntry(db, viewer, {
      description: "Site work",
      projectId: web.id,
      taskId: null,
      tagIds: [],
      billable: true,
      start: new Date("2026-03-09T01:00:00.000Z"),
      end: new Date("2026-03-09T02:30:00.000Z"),
    });
  });

  it("renders the summary as self-contained HTML: title, range, filters, charts, escaped table", async () => {
    const { html, rowCount } = await renderReportHtml(db, viewer, {
      report: "summary",
      query: { ...QUERY, billable: "yes" },
      prefs: PREFS,
      title: "Summary report",
      workspaceName: "Acme <Ops>",
      now: NOW,
    });
    expect(html).toContain("<title>Summary report</title>");
    expect(html).toContain("Acme &lt;Ops&gt;");
    expect(html).toContain("Mar 9 – Mar 15, 2026");
    expect(html).toContain("Billable only");
    expect(html).toContain("Web &amp; &lt;Apps&gt;");
    expect(html).toContain("1:30:00");
    expect(html.match(/<svg/g)?.length).toBe(2);
    // Nothing loaded from elsewhere: the browser never navigates.
    expect(html).not.toMatch(/<(link|script)\b/);
    // The PDF job records the table's rows, as CSV and Excel jobs do.
    expect(rowCount).toBe(1);
  });

  it.skipIf(!localChromePath())(
    "prints it to a PDF",
    async () => {
      expect(existsSync(localChromePath()!)).toBe(true);
      const file = await buildPdfExport(db, viewer, {
        report: "summary",
        query: QUERY,
        prefs: PREFS,
        workspaceName: "Acme",
        now: NOW,
      });
      expect(file.contentType).toBe("application/pdf");
      expect(file.filename).toBe("timekeep-summary-2026-03-09-2026-03-15.pdf");
      expect(new TextDecoder().decode(file.body.slice(0, 5))).toBe("%PDF-");
      expect(file.body.byteLength).toBeGreaterThan(5_000);
    },
    60_000,
  );
});
