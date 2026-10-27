"use server";

import { parseReportQuery, REPORT_KINDS, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { z } from "zod";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { env } from "@/server/env";
import { createShareLink, isShareExpiry, revokeShareLink } from "@/server/share-links";
import { requireWorkspaceAccess } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

const createSchema = z.object({
  kind: z.enum(REPORT_KINDS),
  /** The report's serialised query, as the page URL carries it. */
  params: z.string().max(4000),
  title: z.string().trim().min(1, "Give the link a title").max(120),
  expiresInDays: z.number().int().nullable(),
});

/** Creates a read-only public link to the report as the viewer sees it now. */
export async function createShareLinkAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { kind, params, title, expiresInDays } = parsed.data;
    if (expiresInDays !== null && !isShareExpiry(expiresInDays)) return fail("Invalid expiry.");
    const viewer = await viewerFor(ctx);
    const created = await createShareLink(
      getDb(),
      viewer,
      {
        kind,
        query: parseReportQuery(new URLSearchParams(params)),
        title,
        expiresInDays: expiresInDays ?? undefined,
      },
      resolveViewerPrefs(ctx.user, ctx.settings),
    );
    return ok({ url: `${env().APP_URL}${created.path}` });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function revokeShareLinkAction(slug: string, id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await viewerFor(ctx);
    await revokeShareLink(getDb(), viewer, id);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
