"use server";

import { getDb } from "@timekeep/db";
import { after } from "next/server";

import { type ActionResult, fail, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { exportDownloadUrl, retryExportJob, runExportJob } from "@/server/export-jobs";
import { requireWorkspaceAccess } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

/** A short-lived link to one of the viewer's export files. */
export async function exportDownloadAction(
  slug: string,
  jobId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await viewerFor(ctx);
    return ok({ url: await exportDownloadUrl(getDb(), viewer, jobId) });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** Queues a failed export again and builds it after the response. */
export async function retryExportAction(slug: string, jobId: string): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await viewerFor(ctx);
    const db = getDb();
    const job = await retryExportJob(db, viewer, jobId);
    after(() => runExportJob(db, job.id));
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
