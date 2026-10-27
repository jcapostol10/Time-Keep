import "server-only";

import { notFound } from "next/navigation";

import type { Viewer } from "./catalog/viewer";
import { WorkspaceAccessError } from "./access-error";

/*
 * Kept apart from authz.ts, which scripts (report:perf) load outside Next:
 * next/navigation does not load there.
 */

/** Pages: a refusal renders the not-found page, as requireWorkspacePage does. */
export async function authorizePage(check: () => Promise<Viewer>): Promise<Viewer> {
  try {
    return await check();
  } catch (error) {
    if (error instanceof WorkspaceAccessError) notFound();
    throw error;
  }
}
