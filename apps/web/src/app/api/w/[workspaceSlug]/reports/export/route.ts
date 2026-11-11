import { parseReportQuery, REPORT_KINDS, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { after } from "next/server";
import { z } from "zod";

import { createExportJob, expireExportJobs, runExportJob } from "@/server/export-jobs";
import { env } from "@/server/env";
import { buildExport, countExportRows } from "@/server/report-files";
import { buildPdfExport } from "@/server/report-pdf";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";
import { authorize } from "@/server/authz";

const requestSchema = z.object({
  report: z.enum([...REPORT_KINDS, "attendance", "profit", "expenses", "receipts", "assignments"]),
  format: z.enum(["csv", "xlsx", "pdf", "zip"]),
});

/** Vercel Functions answer with at most 4.5 MB; leave room for headers. */
const MAX_STREAMED_BYTES = 4 * 1024 * 1024;

/** A Content-Disposition value that survives any file name. */
function attachment(filename: string): string {
  return `attachment; filename="${filename.replace(/[^\w.\- ]+/g, "_")}"`;
}

/**
 * The current report as a file. Small exports stream back; one over
 * EXPORT_JOB_THRESHOLD rows (or 4 MB) becomes an export job built after
 * the response, and the answer is 202 with the job's id. The receipts zip
 * (Phase 6c) is always a job.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/export">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const params = new URL(request.url).searchParams;
    const parsed = requestSchema.safeParse({
      report: params.get("report"),
      format: params.get("format"),
    });
    if (!parsed.success) return Response.json({ error: "Invalid export" }, { status: 400 });
    const { report, format } = parsed.data;
    // A zip is the receipts and nothing else.
    if ((format === "zip") !== (report === "receipts")) {
      return Response.json({ error: "Invalid export" }, { status: 400 });
    }

    const db = getDb();
    // Attendance is every member's own (decision 13): it asks attendance.read, not the Reports
    // page; the receipts are the expenses the viewer may read (Phase 6c).
    const own = { kind: "entry", userId: access.user.id, projectId: null } as const;
    const viewer =
      report === "attendance"
        ? await authorize(access, "attendance.read", { kind: "person", userId: access.user.id })
        : report === "receipts"
          ? await authorize(access, "expense.read", own)
          : await authorize(access, "page.view", { kind: "page", page: "reports" });
    // Profit is cost: only for those the matrix lets see it (Phase 6a).
    if (report === "profit") await authorize(access, "report.viewCosts");
    const query = parseReportQuery(params);
    const prefs = resolveViewerPrefs(access.user, access.settings);

    const queue = async (
      jobReport: Exclude<typeof report, "profit" | "assignments">,
      jobFormat: typeof format,
    ) => {
      const job = await createExportJob(db, viewer, {
        report: jobReport,
        format: jobFormat,
        query,
        prefs,
      });
      after(async () => {
        await expireExportJobs(db);
        await runExportJob(db, job.id);
      });
      return Response.json({ jobId: job.id }, { status: 202 });
    };
    if (report === "receipts") return queue("receipts", "zip");
    if (format === "zip") return Response.json({ error: "Invalid export" }, { status: 400 });

    const req = { report, format, query, prefs };
    // A Profit or Assignments export is one row per group: it always streams (no export job).
    const queued =
      report === "profit" || report === "assignments" ? null : () => queue(report, format);
    if (queued && (await countExportRows(db, viewer, req)) > env().EXPORT_JOB_THRESHOLD) {
      return queued();
    }
    const file =
      req.format === "pdf"
        ? await buildPdfExport(db, viewer, { ...req, workspaceName: access.workspace.name })
        : await buildExport(db, viewer, { ...req, format: req.format });
    if (file.body.byteLength > MAX_STREAMED_BYTES) {
      if (!queued) return Response.json({ error: "This export is too large." }, { status: 413 });
      return queued();
    }
    return new Response(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": attachment(file.filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "exports");
  }
}
