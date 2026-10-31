import { importOptionsSchema, MAX_IMPORT_BYTES } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { commitEntryImport, ImportError, planEntryImport } from "@/server/entry-import";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/**
 * Import time entries from a CSV (multipart: `file`, `options` as JSON).
 * `?dryRun=1` checks every row and answers the plan; otherwise `options`
 * carries the plan's `fingerprint` and the ready rows are written. A route
 * handler, not a server action: the file may be 4 MB, over the action
 * body limit.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-entries/import">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "import.entries");
    // Refuse an oversized upload before reading it: the file's limit plus room for the
    // multipart framing and the options.
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_IMPORT_BYTES + 64 * 1024) {
      return Response.json({ error: "The file is over 4 MB." }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new BadRequestError("Choose a CSV file.");
    if (file.size > MAX_IMPORT_BYTES) throw new BadRequestError("The file is over 4 MB.");
    const rawOptions = form.get("options");
    let rawJson: unknown = null;
    try {
      rawJson = typeof rawOptions === "string" ? JSON.parse(rawOptions) : null;
    } catch {
      throw new BadRequestError("Invalid import options.");
    }
    const parsed = importOptionsSchema.safeParse(rawJson);
    if (!parsed.success) throw new BadRequestError("Invalid import options.");
    const text = await file.text();
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const db = getDb();
    if (dryRun) {
      const plan = await planEntryImport(db, viewer, text, parsed.data);
      return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
    }
    const { fingerprint, ...options } = parsed.data;
    if (!fingerprint) throw new BadRequestError("Check the file before importing it.");
    const result = await commitEntryImport(db, viewer, text, options, fingerprint);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ImportError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return routeErrorResponse(error, "import");
  }
}
