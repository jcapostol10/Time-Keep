import { expect, type Locator, type Page } from "@playwright/test";

import { waitForApp } from "./app";
import { escapeRegExp } from "./catalog";

/** Actions on the Expenses page (Phase 6c): categories, expenses and their rows. */

export async function openExpenses(page: Page, slug: string, tab?: "categories") {
  await page.goto(`/w/${slug}/expenses${tab ? `?tab=${tab}` : ""}`);
  await waitForApp(page);
}

/** A category row on the Categories tab, by name. */
export const categoryRow = (page: Page, name: string) =>
  page
    .getByRole("table", { name: "Expense categories" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

/** Adds a category through the Categories tab (owners and admins). */
export async function addCategory(
  page: Page,
  slug: string,
  opts: {
    name: string;
    kind: "Fixed amount" | "Per unit";
    unit?: string;
    price?: string;
    billable?: boolean;
  },
) {
  await openExpenses(page, slug, "categories");
  await page.getByRole("button", { name: "Add category" }).click();
  const dialog = page.getByRole("dialog", { name: "Add category" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(opts.name);
  await dialog.getByRole("radio", { name: opts.kind }).click();
  if (opts.unit) {
    await dialog.getByRole("textbox", { name: "Unit", exact: true }).fill(opts.unit);
  }
  if (opts.price) await dialog.getByRole("textbox", { name: /^Price per unit/ }).fill(opts.price);
  if (opts.billable === false) {
    await dialog.getByRole("switch", { name: "Billable by default" }).click();
  }
  await dialog.getByRole("button", { name: "Save category" }).click();
  await expect(dialog).toBeHidden();
  await expect(categoryRow(page, opts.name)).toBeVisible();
}

/** An expense row on the Expenses table, by its description. */
export const expenseRow = (page: Page, description: string) =>
  page
    .getByRole("table", { name: "Expenses", exact: true })
    .getByRole("row", { name: new RegExp(escapeRegExp(description)) });

/** The Expenses table's Total row. */
export const expensesTotal = (page: Page) =>
  page
    .getByRole("table", { name: "Expenses", exact: true })
    .getByRole("row")
    .filter({ hasText: /^Total/ });

/**
 * Fills and saves the Add expense dialog. `beforeSave` runs with the dialog
 * filled, for assertions on what it shows (the computed amount).
 */
export async function addExpense(
  page: Page,
  slug: string,
  opts: {
    project: string;
    category: string;
    amount?: string;
    quantity?: string;
    date?: string;
    description?: string;
    receipt?: string;
    billable?: boolean;
    beforeSave?: (dialog: Locator) => Promise<void>;
  },
) {
  if (!page.url().includes(`/w/${slug}/expenses`) || page.url().includes("tab=")) {
    await openExpenses(page, slug);
  }
  await page.getByRole("button", { name: "Add expense" }).click();
  const dialog = page.getByRole("dialog", { name: "Add expense" });
  await dialog.getByRole("button", { name: /^Project:/ }).click();
  await page.getByRole("combobox", { name: "Search projects" }).fill(opts.project);
  await page.getByRole("option", { name: opts.project, exact: true }).click();
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: opts.category, exact: true }).click();
  if (opts.date) await dialog.getByLabel("Date").fill(opts.date);
  if (opts.amount) await dialog.getByRole("textbox", { name: /^Amount/ }).fill(opts.amount);
  if (opts.quantity) await dialog.getByRole("textbox", { name: /^Quantity/ }).fill(opts.quantity);
  if (opts.billable !== undefined) {
    const sw = dialog.getByRole("switch", { name: "Billable" });
    if (((await sw.getAttribute("aria-checked")) === "true") !== opts.billable) await sw.click();
  }
  if (opts.description) {
    await dialog.getByRole("textbox", { name: "Description" }).fill(opts.description);
  }
  if (opts.receipt) await dialog.getByLabel("Receipt").setInputFiles(opts.receipt);
  if (opts.beforeSave) await opts.beforeSave(dialog);
  await dialog.getByRole("button", { name: "Save expense" }).click();
  await expect(dialog).toBeHidden();
  // A quick second add can overlap the first toast: any one is enough.
  await expect(page.getByText("Expense saved").first()).toBeVisible();
  if (opts.description) await expect(expenseRow(page, opts.description)).toBeVisible();
}

/** Opens an expense row's menu and picks an item. */
export async function expenseAction(page: Page, description: string, item: string) {
  await expenseRow(page, description).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
