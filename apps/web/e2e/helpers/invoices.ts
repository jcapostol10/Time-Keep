import { expect, type Page } from "@playwright/test";

import { waitForApp } from "./app";

/** Actions on the Invoices page and the invoice editor (Phase 6d). */

export async function openInvoices(page: Page, slug: string, tab?: "recurring" | "settings") {
  await page.goto(`/w/${slug}/invoices${tab ? `?tab=${tab}` : ""}`);
  await waitForApp(page);
}

/** The Invoices table row of an invoice, by its number. */
export const invoiceRow = (page: Page, number: string) =>
  page
    .getByRole("table", { name: "Invoices" })
    .getByRole("row", { name: new RegExp(`\\b${number}\\b`) });

/** The editor's computed status badge. */
export const invoiceStatus = (page: Page) => page.getByTestId("invoice-status");

/** The editor's total. */
export const invoiceTotal = (page: Page) => page.getByTestId("invoice-total");

/** The editor's balance due. */
export const invoiceBalance = (page: Page) => page.getByTestId("invoice-balance");

/** The Lines table row of a line, by its description. */
export const lineRow = (page: Page, description: string) =>
  page.getByRole("table", { name: "Lines" }).getByRole("row", { name: new RegExp(description) });

/**
 * A new draft for `client` through the New invoice dialog; lands on the
 * editor and answers its number.
 */
export async function createInvoice(
  page: Page,
  slug: string,
  client: string,
  dates: { issueDate?: string; dueDate?: string } = {},
): Promise<string> {
  await openInvoices(page, slug);
  await page.getByRole("button", { name: "New invoice" }).click();
  const dialog = page.getByRole("dialog", { name: "New invoice" });
  await dialog.getByRole("combobox", { name: "Client" }).click();
  await page.getByRole("option", { name: client, exact: true }).click();
  if (dates.issueDate) await dialog.getByLabel("Issue date").fill(dates.issueDate);
  if (dates.dueDate) await dialog.getByLabel("Due date").fill(dates.dueDate);
  await dialog.getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/invoices/[\\w-]+$`));
  await waitForApp(page);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^Invoice \S+$/);
  return ((await heading.textContent()) ?? "").replace(/^Invoice /, "");
}

/** "Import time and expenses" with the dialog's defaults unless given. */
export async function importTime(
  page: Page,
  opts: { from?: string; to?: string; groupBy?: "Project" | "Task" | "Person" | "Entry" } = {},
) {
  await page.getByRole("button", { name: "Import time and expenses" }).click();
  const dialog = page.getByRole("dialog", { name: "Import time and expenses" });
  if (opts.from) await dialog.getByLabel("From").fill(opts.from);
  if (opts.to) await dialog.getByLabel("To").fill(opts.to);
  if (opts.groupBy) {
    await dialog.getByRole("combobox", { name: "Group by" }).click();
    await page.getByRole("option", { name: opts.groupBy, exact: true }).click();
  }
  await expect(dialog.getByTestId("import-preview")).toContainText(/entr/);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A manual line: quantity and unit price as typed ("2", "100"). */
export async function addLine(
  page: Page,
  line: { description: string; quantity: string; unitPrice: string },
) {
  await page.getByRole("button", { name: "Add line" }).click();
  const dialog = page.getByRole("dialog", { name: "Add line" });
  await dialog.getByLabel("Description").fill(line.description);
  await dialog.getByLabel("Quantity").fill(line.quantity);
  await dialog.getByLabel(/^Unit price/).fill(line.unitPrice);
  await dialog.getByRole("button", { name: "Save line" }).click();
  await expect(dialog).toBeHidden();
  await expect(lineRow(page, line.description)).toBeVisible();
}

/** Send with the client's email, or only mark the invoice as sent. */
export async function sendInvoice(page: Page, opts: { email: boolean }) {
  await page.getByRole("button", { name: "Send…" }).click();
  const dialog = page.getByRole("dialog", { name: "Send invoice" });
  await dialog
    .getByRole("button", { name: opts.email ? "Send email" : "Mark as sent only" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(invoiceStatus(page)).not.toHaveText("Draft");
}

/** Records a payment of `amount` (as typed) today. */
export async function recordPayment(page: Page, amount: string) {
  await page.getByRole("button", { name: "Record payment" }).click();
  const dialog = page.getByRole("dialog", { name: "Record payment" });
  await dialog.getByLabel(/^Amount/).fill(amount);
  await dialog.getByRole("button", { name: "Save payment" }).click();
  await expect(dialog).toBeHidden();
}

/** The path of the public invoice link in an email's text. */
export function publicLinkIn(text: string): string {
  const match = /\/invoice\/[A-Za-z0-9_-]{20,}/.exec(text);
  if (!match) throw new Error("No public invoice link in the email");
  return match[0];
}
