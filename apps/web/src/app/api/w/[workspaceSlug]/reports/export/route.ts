import { parseReportQuery, REPORT_KINDS, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { z } from "zod";

import { buildExport } from "@/server/report-files";
import { accessErrorResponse, requireWorkspaceAccess } from "@/server/workspace-access";

const requestSchema = z.object({
  report: z.enum(REPORT_KINDS),
  format: z.enum(["csv", "xlsx"]),
});

/** A Content-Disposition value that survives any file name. */
function attachment(filename: string): string {
  return `attachment; filename="${filename.replace(/[^\w.\- ]+/g, "_")}"`;
}

/** The current report as a file, for the query in the URL. */
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

    const viewer = { workspaceId: access.workspace.id, userId: access.user.id, role: access.role };
    const file = await buildExport(getDb(), viewer, {
      ...parsed.data,
      query: parseReportQuery(params),
      prefs: resolveViewerPrefs(access.user, access.settings),
    });
    return new Response(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": attachment(file.filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      Response.json({ error: "Something went wrong." }, { status: 500 })
    );
  }
}
