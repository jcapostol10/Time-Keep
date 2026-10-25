import "server-only";

import { randomUUID } from "node:crypto";

import {
  type ExportFormat,
  type ReportKind,
  type ReportQuery,
  reportQuerySchema,
  type ViewerPrefs,
} from "@timekeep/core";
import {
  and,
  type Database,
  desc,
  eq,
  type ExportJob,
  exportJob,
  isNotNull,
  lt,
  membership,
  user,
  workspace,
} from "@timekeep/db";

import { workspaceRoutes } from "@/lib/routes";

import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";
import { env } from "./env";
import { sendEmail } from "./mail";
import { buildExport, type ExportFile } from "./report-files";
import { buildPdfExport } from "./report-pdf";
import { deleteExport, presignedExportUrl, uploadExport } from "./storage";

/**
 * Exports too large to stream back. A job is built after the response
 * (Next's after()), stored in the private export bucket and listed under
 * Reports → Exports for seven days. runExportJob is one call so a worker
 * can run it later instead (see docs/BACKLOG.md).
 */

const KEEP_DAYS = 7;
const STUCK_MINUTES = 15;
const DOWNLOAD_TTL_SECONDS = 15 * 60;

export interface ExportJobInput {
  report: ReportKind;
  format: ExportFormat;
  query: ReportQuery;
  prefs: ViewerPrefs;
  now?: Date;
}

/** What the job row's jsonb keeps: the query and the creator's preferences at the time. */
interface StoredRequest {
  query: ReportQuery;
  prefs: ViewerPrefs;
}

export interface ExportJobDTO {
  id: string;
  report: string;
  format: ExportFormat;
  status: ExportJob["status"];
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string;
  /** A done job whose file is still kept. */
  downloadable: boolean;
}

function toDTO(job: ExportJob, now: Date): ExportJobDTO {
  return {
    id: job.id,
    report: job.report,
    format: job.format,
    status: job.status,
    rowCount: job.rowCount,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt.toISOString(),
    downloadable: job.status === "done" && job.objectKey !== null && job.expiresAt > now,
  };
}

export async function createExportJob(
  db: Database,
  viewer: Viewer,
  input: ExportJobInput,
): Promise<ExportJobDTO> {
  const now = input.now ?? new Date();
  const stored: StoredRequest = { query: input.query, prefs: input.prefs };
  const [row] = await db
    .insert(exportJob)
    .values({
      id: randomUUID(),
      workspaceId: viewer.workspaceId,
      userId: viewer.userId,
      format: input.format,
      report: input.report,
      query: stored as unknown as Record<string, unknown>,
      createdAt: now,
      expiresAt: new Date(now.getTime() + KEEP_DAYS * 24 * 3_600_000),
    })
    .returning();
  if (!row) throw new Error("Export job could not be created");
  return toDTO(row, now);
}

async function ownJob(db: Database, viewer: Viewer, jobId: string): Promise<ExportJob> {
  const row = await db.query.exportJob.findFirst({
    where: and(
      eq(exportJob.id, jobId),
      eq(exportJob.workspaceId, viewer.workspaceId),
      eq(exportJob.userId, viewer.userId),
    ),
  });
  if (!row) throw new CatalogError("NOT_FOUND", "Export not found.");
  return row;
}

/** Emails the job's owner that the file is ready, with a link to the Exports list. */
async function notifyOwner(job: ExportJobDTO, db: Database) {
  const row = await db
    .select({ email: user.email, name: user.name, slug: workspace.slug })
    .from(exportJob)
    .innerJoin(user, eq(user.id, exportJob.userId))
    .innerJoin(workspace, eq(workspace.id, exportJob.workspaceId))
    .where(eq(exportJob.id, job.id))
    .then((rows) => rows[0]);
  if (!row) return;
  await sendEmail({
    to: row.email,
    subject: "Your TimeKeep export is ready",
    title: "Your export is ready",
    intro: `Hi ${row.name}, the ${job.report} report you exported (${job.rowCount ?? 0} rows) is ready to download.`,
    cta: {
      label: "Open exports",
      url: `${env().APP_URL}${workspaceRoutes.reports(row.slug)}/exports`,
    },
    outro: `The file is kept for ${KEEP_DAYS} days.`,
  });
}

export interface RunOptions {
  now?: Date;
  /** Tells the owner; defaults to an email. A failure here never fails the job. */
  notify?: (job: ExportJobDTO) => Promise<void>;
  /** Builds the file; defaults to buildExport (PDF: report-pdf). */
  build?: (job: ExportJob, request: StoredRequest) => Promise<ExportFile>;
}

async function defaultBuild(
  db: Database,
  job: ExportJob,
  request: StoredRequest,
): Promise<ExportFile> {
  const viewer: Viewer = { workspaceId: job.workspaceId, userId: job.userId, role: "member" };
  // The creator's role at build time decides whose time is in the file.
  const member = await db.query.membership.findFirst({
    where: and(eq(membership.workspaceId, job.workspaceId), eq(membership.userId, job.userId)),
    columns: { role: true, status: true },
  });
  if (!member || member.status !== "ACTIVE") throw new Error("The creator is no longer a member");
  viewer.role = member.role;
  if (job.report === "project-status") {
    throw new Error("Project status exports stream; they never become jobs");
  }
  const query = reportQuerySchema.parse(request.query);
  if (job.format === "pdf") {
    const ws = await db.query.workspace.findFirst({
      where: eq(workspace.id, job.workspaceId),
      columns: { name: true },
    });
    return buildPdfExport(db, viewer, {
      report: job.report,
      query,
      prefs: request.prefs,
      workspaceName: ws?.name ?? "",
    });
  }
  return buildExport(db, viewer, {
    report: job.report,
    format: job.format,
    query,
    prefs: request.prefs,
  });
}

/** Builds a queued job's file, stores it and marks the job done or failed. */
export async function runExportJob(db: Database, jobId: string, options: RunOptions = {}) {
  const [job] = await db
    .update(exportJob)
    .set({ status: "running", error: null })
    .where(and(eq(exportJob.id, jobId), eq(exportJob.status, "queued")))
    .returning();
  if (!job) return;
  const request = job.query as unknown as StoredRequest;
  try {
    const file = await (options.build
      ? options.build(job, request)
      : defaultBuild(db, job, request));
    const ext = file.filename.split(".").pop() ?? job.format;
    const key = `exports/${job.workspaceId}/${job.id}.${ext}`;
    await uploadExport({ key, body: file.body, contentType: file.contentType });
    const [done] = await db
      .update(exportJob)
      .set({
        status: "done",
        rowCount: file.rowCount,
        objectKey: key,
        finishedAt: options.now ?? new Date(),
      })
      .where(eq(exportJob.id, job.id))
      .returning();
    if (done) {
      const dto = toDTO(done, options.now ?? new Date());
      await (options.notify ? options.notify(dto) : notifyOwner(dto, db)).catch((error: unknown) =>
        console.error("[exports] could not notify the owner", error),
      );
    }
  } catch (error) {
    console.error(`[exports] job ${job.id} failed`, error);
    await db
      .update(exportJob)
      .set({
        status: "failed",
        error: "The export could not be built.",
        finishedAt: options.now ?? new Date(),
      })
      .where(eq(exportJob.id, job.id));
  }
}

export async function listExportJobs(db: Database, viewer: Viewer, now = new Date()) {
  const rows = await db
    .select()
    .from(exportJob)
    .where(and(eq(exportJob.workspaceId, viewer.workspaceId), eq(exportJob.userId, viewer.userId)))
    .orderBy(desc(exportJob.createdAt))
    .limit(20);
  return rows.map((r) => toDTO(r, now));
}

/** A 15-minute link to the file, for its owner only. */
export async function exportDownloadUrl(
  db: Database,
  viewer: Viewer,
  jobId: string,
  now = new Date(),
): Promise<string> {
  const job = await ownJob(db, viewer, jobId);
  if (job.status === "done" && job.expiresAt <= now) {
    throw new CatalogError("INVALID", "This export has expired.");
  }
  if (job.status !== "done" || !job.objectKey) {
    throw new CatalogError("INVALID", "This export is not ready.");
  }
  const ext = job.objectKey.split(".").pop() ?? job.format;
  return presignedExportUrl(job.objectKey, DOWNLOAD_TTL_SECONDS, `timekeep-${job.report}.${ext}`);
}

/** Puts a failed job back in the queue. */
export async function retryExportJob(db: Database, viewer: Viewer, jobId: string) {
  const job = await ownJob(db, viewer, jobId);
  if (job.status !== "failed")
    throw new CatalogError("INVALID", "Only a failed export can be retried.");
  const [row] = await db
    .update(exportJob)
    .set({ status: "queued", error: null, finishedAt: null })
    .where(eq(exportJob.id, job.id))
    .returning();
  if (!row) throw new CatalogError("NOT_FOUND", "Export not found.");
  return toDTO(row, new Date());
}

/**
 * Housekeeping, run with every new export: deletes files past their expiry
 * and fails jobs that have been running too long (a function killed
 * mid-build never finishes them).
 */
export async function expireExportJobs(db: Database, now = new Date()) {
  const expired = await db
    .select({ id: exportJob.id, objectKey: exportJob.objectKey })
    .from(exportJob)
    .where(and(isNotNull(exportJob.objectKey), lt(exportJob.expiresAt, now)));
  for (const row of expired) {
    if (row.objectKey) await deleteExport(row.objectKey).catch(() => undefined);
    await db.update(exportJob).set({ objectKey: null }).where(eq(exportJob.id, row.id));
  }
  await db
    .update(exportJob)
    .set({ status: "failed", error: "The export timed out.", finishedAt: now })
    .where(
      and(
        eq(exportJob.status, "running"),
        lt(exportJob.createdAt, new Date(now.getTime() - STUCK_MINUTES * 60_000)),
      ),
    );
}
