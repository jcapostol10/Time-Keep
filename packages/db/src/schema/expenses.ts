import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project } from "./catalog";
import { timestamps } from "./columns";
import { expenseCategoryKindEnum } from "./enums";
import { invoice } from "./invoices";
import { workspace } from "./workspace";

/**
 * What an expense is (Phase 6c, decision 14): a fixed amount typed each time,
 * or a unit (km, pages…) with a price per unit. Prices are in the workspace
 * currency; a change touches no saved expense, which keeps its snapshot.
 */
export const expenseCategory = pgTable(
  "expense_category",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: expenseCategoryKindEnum("kind").notNull(),
    unitName: text("unit_name"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }),
    billableDefault: boolean("billable_default").notNull().default(true),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("expense_category_workspace_name_uq").on(t.workspaceId, t.name),
    index("expense_category_workspace_id_idx").on(t.workspaceId),
  ],
).enableRLS();

/**
 * Money a person spent on a project, on a local date, always in the workspace
 * currency (decision 14). Written only by `server/expenses.ts`, through the
 * approval guard (decision 17). A project or category with expenses cannot be
 * deleted (restrict); `invoice_id` gets its foreign key in Phase 6d.
 */
export const expense = pgTable(
  "expense",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => expenseCategory.id, { onDelete: "restrict" }),
    /** The day the money was spent: a date, in no time zone. */
    date: date("date").notNull(),
    /** Minor units of the workspace currency: typed, or quantity × unit price. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** UNIT categories: the quantity in hundredths. */
    quantityCenti: integer("quantity_centi"),
    /** UNIT categories: the category's price when the expense was saved. */
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }),
    billable: boolean("billable").notNull(),
    description: text("description").notNull().default(""),
    /** The receipt in the private export bucket (decision 15), and its thumbnail. */
    receiptKey: text("receipt_key"),
    receiptThumbKey: text("receipt_thumb_key"),
    receiptMime: text("receipt_mime"),
    /** Set when an invoice takes the expense (Phase 6d): read-only while set. */
    invoiceId: text("invoice_id").references(() => invoice.id, { onDelete: "set null" }),
    /** Who recorded it: the person, or an admin or manager adding for them. */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("expense_workspace_user_date_idx").on(t.workspaceId, t.userId, t.date),
    index("expense_workspace_project_date_idx").on(t.workspaceId, t.projectId, t.date),
  ],
).enableRLS();

export type ExpenseCategory = typeof expenseCategory.$inferSelect;
export type Expense = typeof expense.$inferSelect;
