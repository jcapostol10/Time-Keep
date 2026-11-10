import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { client } from "./catalog";
import { timestamps } from "./columns";
import {
  invoiceItemKindEnum,
  invoiceStatusEnum,
  recurringModeEnum,
  recurringScheduleEnum,
} from "./enums";
import { workspace } from "./workspace";

/**
 * Invoicing (Phase 6d, decisions 20–28). Written only by `server/invoices/*`;
 * `time_entry.invoice_id` and `expense.invoice_id` by the entry and expense
 * services' `markInvoiced` / `releaseInvoiced`.
 */

/** Numbering and branding, one row per workspace, created on first use. */
export const invoiceSettings = pgTable("invoice_settings", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull().default(""),
  address: text("address").notNull().default(""),
  /** A tax or registration number line printed under the address. */
  taxLine: text("tax_line").notNull().default(""),
  /** Default notes on a new invoice. */
  notes: text("notes").notNull().default(""),
  paymentTermsDays: smallint("payment_terms_days").notNull().default(30),
  numberPrefix: text("number_prefix").notNull().default("INV-"),
  /** The next number to take, under `SELECT … FOR UPDATE` of this row. */
  nextNumber: integer("next_number").notNull().default(1),
  numberPadding: smallint("number_padding").notNull().default(4),
  tax1Name: text("tax1_name"),
  /** Hundredths of a percent. */
  tax1Bps: integer("tax1_bps"),
  tax2Name: text("tax2_name"),
  tax2Bps: integer("tax2_bps"),
  ...timestamps,
}).enableRLS();

/** A template the daily job turns into one invoice per period (decision 27). */
export const recurringInvoice = pgTable(
  "recurring_invoice",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    schedule: recurringScheduleEnum("schedule").notNull(),
    /** WEEKLY: 0 = Sunday … 6 = Saturday. */
    weekday: smallint("weekday"),
    /** MONTHLY: 1–31, clamped to the month's last day. */
    dayOfMonth: smallint("day_of_month"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    /** Fixed manual lines (`InvoiceLineInput[]`). */
    lines: jsonb("lines")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Also import the period just ended, grouped by `import_group_by`. */
    importPeriod: boolean("import_period").notNull().default(false),
    importGroupBy: text("import_group_by").notNull().default("project"),
    mode: recurringModeEnum("mode").notNull().default("DRAFT"),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("recurring_invoice_workspace_idx").on(t.workspaceId)],
).enableRLS();

/**
 * An invoice: one client, that client's currency at creation, a number from
 * the workspace sequence. Stored status is DRAFT, SENT or VOID; PAID,
 * PARTIALLY_PAID and OVERDUE are computed (decision 21). Totals are cached
 * from the lines by `recomputeTotals`.
 */
export const invoice = pgTable(
  "invoice",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("DRAFT"),
    /** Hundredths of a percent of the subtotal. */
    discountBps: integer("discount_bps").notNull().default(0),
    tax1Name: text("tax1_name"),
    tax1Bps: integer("tax1_bps"),
    tax2Name: text("tax2_name"),
    tax2Bps: integer("tax2_bps"),
    notes: text("notes").notNull().default(""),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The frozen PDF in the private export bucket, written on send. */
    pdfKey: text("pdf_key"),
    /** sha256 of the public link's token; the token itself is shown once. */
    publicTokenHash: text("public_token_hash"),
    /** The public page's last PDF download: one per 10 s (decision 25). */
    lastDownloadAt: timestamp("last_download_at", { withTimezone: true }),
    recurringId: text("recurring_id").references(() => recurringInvoice.id, {
      onDelete: "set null",
    }),
    /** The period a recurring template billed, unique per template. */
    periodKey: text("period_key"),
    /** The accounting system's reference (decision 28); nothing sets it yet. */
    externalRef: text("external_ref"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("invoice_workspace_number_uq").on(t.workspaceId, t.number),
    uniqueIndex("invoice_recurring_period_uq")
      .on(t.recurringId, t.periodKey)
      .where(sql`"recurring_id" IS NOT NULL`),
    uniqueIndex("invoice_public_token_uq")
      .on(t.publicTokenHash)
      .where(sql`"public_token_hash" IS NOT NULL`),
    index("invoice_workspace_status_due_idx").on(t.workspaceId, t.status, t.dueDate),
  ],
).enableRLS();

/** A line: imported time or expenses (holding what it took), or a manual quantity × price. */
export const invoiceItem = pgTable(
  "invoice_item",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: invoiceItemKindEnum("kind").notNull(),
    description: text("description").notNull(),
    /** Hundredths: hours for time, a count for expenses, the typed quantity for a manual line. */
    quantityCenti: integer("quantity_centi").notNull(),
    /** Null when an imported line's entries have different rates. */
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** The entries and expenses an imported line took, released with it. */
    entryIds: text("entry_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expenseIds: text("expense_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [index("invoice_item_invoice_position_idx").on(t.invoiceId, t.position)],
).enableRLS();

/** Money received against a sent invoice (decision 26). */
export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payment_invoice_idx").on(t.invoiceId)],
).enableRLS();

export type InvoiceSettings = typeof invoiceSettings.$inferSelect;
export type RecurringInvoice = typeof recurringInvoice.$inferSelect;
export type Invoice = typeof invoice.$inferSelect;
export type InvoiceItem = typeof invoiceItem.$inferSelect;
export type Payment = typeof payment.$inferSelect;
