import { getDb } from "@timekeep/db";

import { env } from "@/server/env";
import { buildExport, countExportRows } from "@/server/report-files";
import { buildPdfExport } from "@/server/report-pdf";
import { resolveShareLink } from "@/server/share-links";

const MAX_STREAMED_BYTES = 4 * 1024 * 1024;

function attachment(filename: string): string {
  return `attachment; filename="${filename.replace(/[^\w.\- ]+/g, "_")}"`;
}

/**
 * The shared report as CSV or PDF for someone without an account. There is
 * no one to own an export job, so a report over the threshold is refused.
 */
export async function GET(request: Request, ctx: RouteContext<"/share/[token]/export">) {
  const { token } = await ctx.params;
  const db = getDb();
  const link = await resolveShareLink(db, token);
  if (!link) return new Response("This link is no longer available.", { status: 404 });
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "csv" && format !== "pdf") {
    return new Response("Unsupported format.", { status: 400 });
  }
  const req = { report: link.kind, query: link.query, prefs: link.prefs };
  try {
    if ((await countExportRows(db, link.viewer, req)) > env().EXPORT_JOB_THRESHOLD) {
      return new Response(
        "This report is too large to download from a shared link; ask whoever shared it for the file.",
        { status: 413 },
      );
    }
    const file =
      format === "pdf"
        ? await buildPdfExport(db, link.viewer, {
            ...req,
            title: link.title,
            workspaceName: link.workspaceName,
          })
        : await buildExport(db, link.viewer, { ...req, format });
    if (file.body.byteLength > MAX_STREAMED_BYTES) {
      return new Response("This report is too large to download from a shared link.", {
        status: 413,
      });
    }
    return new Response(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": attachment(file.filename),
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("[share] export failed", error);
    return new Response("Something went wrong.", { status: 500 });
  }
}
