import type { Page } from "@playwright/test";
import { addDaysToKey, localDateKey, zonedDateTimeToInstant } from "@timekeep/core";

import { expect, test } from "./fixtures";
import { uniqueEmail } from "./helpers/app";
import { runDailyJob } from "./helpers/approvals";
import { createClientViaUi, createProjectViaUi } from "./helpers/catalog";
import {
  addLine,
  createInvoice,
  importTime,
  invoiceRow,
  invoiceStatus,
  openInvoices,
  sendInvoice,
} from "./helpers/invoices";
import { waitForEmail, waitForEmailAttachments } from "./helpers/mail";
import { billableOn, setWorkspaceRate } from "./helpers/money";
import { addManualEntry, pickProject } from "./helpers/tracker";

/**
 * Invoicing's slower flows (Phase 6d): the PDF attachment (Mailpit only), the
 * daily job's recurring and overdue work, and voiding.
 */

const tracker = async (page: Page, slug: string) => {
  await page.goto(`/w/${slug}/tracker`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
};

test.describe("invoices (nightly)", { tag: "@nightly" }, () => {
  test("the sent email carries the PDF", async ({ page, freshUser }) => {
    const billing = uniqueEmail("acme");
    await createClientViaUi(page, freshUser.slug, "Acme", { email: billing });
    const number = await createInvoice(page, freshUser.slug, "Acme");
    await addLine(page, { description: "Design", quantity: "1", unitPrice: "100" });
    await sendInvoice(page, { email: true });
    const attachments = await waitForEmailAttachments(billing, new RegExp(`Invoice ${number}`));
    expect(attachments.map((a) => [a.FileName, a.ContentType])).toEqual([
      [`${number}.pdf`, "application/pdf"],
    ]);
    expect(attachments[0]!.Size).toBeGreaterThan(1000);
  });

  test("a recurring invoice appears after the daily job and not twice", async ({
    page,
    freshUser,
  }) => {
    const { slug, timezone } = freshUser;
    await createClientViaUi(page, slug, "Acme");
    const today = localDateKey(new Date(), timezone);
    const thisMonth = `${today.slice(0, 8)}01`;
    const nextMonth = `${addDaysToKey(`${today.slice(0, 8)}28`, 7).slice(0, 8)}01`;

    await openInvoices(page, slug, "recurring");
    await page.getByRole("button", { name: "New recurring invoice" }).click();
    const dialog = page.getByRole("dialog", { name: "New recurring invoice" });
    await dialog.getByLabel("Name").fill("Retainer");
    await dialog.getByRole("combobox", { name: "Client" }).click();
    await page.getByRole("option", { name: "Acme", exact: true }).click();
    await dialog.getByRole("radio", { name: "Monthly" }).click();
    await dialog.getByLabel("Day of month").fill("1");
    await dialog.getByLabel("Start date").fill(thisMonth);
    await dialog.getByRole("button", { name: "Add line" }).click();
    await dialog.getByRole("textbox", { name: "Line 1 description" }).fill("Retainer");
    await dialog.getByRole("textbox", { name: "Line 1 quantity" }).fill("1");
    await dialog.getByRole("textbox", { name: "Line 1 unit price" }).fill("500");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByRole("table", { name: "Recurring invoices" })
        .getByRole("row", { name: /Retainer/ }),
    ).toContainText("Monthly on the 1st");

    const at = zonedDateTimeToInstant({ date: nextMonth, hours: 12, minutes: 0 }, timezone);
    const first = await runDailyJob(page.request, slug, at);
    expect(first.invoices.created).toBe(1);
    await openInvoices(page, slug);
    await expect(invoiceRow(page, "INV-0001")).toContainText("Draft");
    const second = await runDailyJob(page.request, slug, at);
    expect(second.invoices.created).toBe(0);
    await page.reload();
    await expect(page.getByRole("table", { name: "Invoices" }).getByRole("row")).toHaveCount(2);
  });

  test("an overdue invoice emails the admins once", async ({ page, freshUser }) => {
    const { slug, timezone, email } = freshUser;
    await createClientViaUi(page, slug, "Acme");
    const yesterday = addDaysToKey(localDateKey(new Date(), timezone), -1);
    const number = await createInvoice(page, slug, "Acme", {
      issueDate: yesterday,
      dueDate: yesterday,
    });
    await addLine(page, { description: "Design", quantity: "1", unitPrice: "100" });
    await sendInvoice(page, { email: false });
    await expect(invoiceStatus(page)).toHaveText("Overdue");
    const first = await runDailyJob(page.request, slug, new Date());
    expect(first.invoices.overdue).toBe(1);
    await waitForEmail(email, { subject: new RegExp(`${number} is overdue`) });
    const second = await runDailyJob(page.request, slug, new Date());
    expect(second.invoices.overdue).toBe(0);
  });

  test("voiding releases the time and the number stays", async ({ page, freshUser }) => {
    const { slug } = freshUser;
    await setWorkspaceRate(page, slug, "50");
    await createClientViaUi(page, slug, "Acme");
    await createProjectViaUi(page, slug, "Website", { client: "Acme" });
    await tracker(page, slug);
    await pickProject(page, "Website");
    await billableOn(page);
    await addManualEntry(page, { description: "Build", start: "00:05", duration: "1" });
    const number = await createInvoice(page, slug, "Acme");
    await importTime(page);
    await sendInvoice(page, { email: false });
    await page.getByRole("button", { name: "Void" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Void invoice" }).click();
    await expect(invoiceStatus(page)).toHaveText("Void");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Invoice ${number}`);

    await tracker(page, slug);
    const build = page.getByRole("group", { name: "Entry Build" });
    await expect(build.getByRole("img", { name: /On invoice/ })).toHaveCount(0);
    await expect(build.getByRole("textbox", { name: "Description" })).toBeEnabled();
  });
});
