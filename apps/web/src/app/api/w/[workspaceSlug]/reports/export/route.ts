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
  report: z.enum(REPORT_KINDS),
  format: z.enum(["csv", "xlsx", "pdf"]),
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
 * the response, and the answer is 202 with the job's id.
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

    const db = getDb();
    const viewer = await authorize(access, "page.view", { kind: "page", page: "reports" });
    const req = {
      ...parsed.data,
      query: parseReportQuery(params),
      prefs: resolveViewerPrefs(access.user, access.settings),
    };

    const queue = async () => {
      const job = await createExportJob(db, viewer, req);
      after(async () => {
        await expireExportJobs(db);
        await runExportJob(db, job.id);
      });
      return Response.json({ jobId: job.id }, { status: 202 });
    };

    if ((await countExportRows(db, viewer, req)) > env().EXPORT_JOB_THRESHOLD) return queue();
    const file =
      req.format === "pdf"
        ? await buildPdfExport(db, viewer, { ...req, workspaceName: access.workspace.name })
        : await buildExport(db, viewer, { ...req, format: req.format });
    if (file.body.byteLength > MAX_STREAMED_BYTES) return queue();
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
