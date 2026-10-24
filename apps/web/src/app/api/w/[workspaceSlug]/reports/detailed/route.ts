import { z } from "zod";

import { reportRoute } from "@/server/report-route";
import { detailedReport } from "@/server/reports";

const pageSchema = z.object({
  sort: z.enum(["start", "duration"]).default("start"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  cursorValue: z.string().min(1).optional(),
  cursorId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** One keyset page of entries for the query in the URL. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/detailed">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query, params }) => {
    const parsed = pageSchema.safeParse(Object.fromEntries(params));
    const page = parsed.success ? parsed.data : pageSchema.parse({});
    const cursor =
      page.cursorValue && page.cursorId
        ? { value: page.cursorValue, id: page.cursorId }
        : undefined;
    return detailedReport(db, viewer, query, prefs, {
      cursor,
      sort: page.sort,
      dir: page.dir,
      limit: page.limit,
    });
  });
}
