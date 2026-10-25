import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps } from "./columns";
import { exportFormatEnum, exportReportEnum, exportStatusEnum, reportKindEnum } from "./enums";
import { workspace } from "./workspace";

/**
 * A read-only public link to a report. The URL carries a random token; only
 * its sha256 is stored, so a database read cannot reproduce a link. The row
 * keeps the effective query (a member's forced userIds included) and the
 * creator's resolved preferences, so the page renders the same for anyone
 * who opens it, whenever.
 */
export const reportShareLink = pgTable(
  "report_share_link",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    kind: reportKindEnum("kind").notNull(),
    /** The report query as core's reportQuerySchema reads it; parsed on every read. */
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    /** The creator's ViewerPrefs at creation. */
    prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull(),
    title: text("title").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    /** The last export from the public page: one per link every few seconds. */
    lastExportAt: timestamp("last_export_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("report_share_link_token_hash_uq").on(t.tokenHash),
    index("report_share_link_workspace_created_idx").on(t.workspaceId, t.createdAt.desc()),
  ],
).enableRLS();

/**
 * An export too large to stream back: built after the response, stored in
 * the private export bucket, listed under Reports → Exports until it expires.
 */
export const exportJob = pgTable(
  "export_job",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    format: exportFormatEnum("format").notNull(),
    report: exportReportEnum("report").notNull(),
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    status: exportStatusEnum("status").notNull().default("queued"),
    rowCount: integer("row_count"),
    /** Key in the private export bucket once done. */
    objectKey: text("object_key"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The file is deleted after this; the row says "expired". */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("export_job_workspace_user_created_idx").on(t.workspaceId, t.userId, t.createdAt.desc()),
  ],
).enableRLS();

export type ReportShareLink = typeof reportShareLink.$inferSelect;
export type ExportJob = typeof exportJob.$inferSelect;
