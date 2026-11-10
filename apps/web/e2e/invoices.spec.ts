import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { uniqueEmail, waitForApp } from "./helpers/app";
import { createClientViaUi, createProjectViaUi } from "./helpers/catalog";
import {
  addLine,
  createInvoice,
  importTime,
  invoiceBalance,
  invoiceStatus,
  invoiceTotal,
  lineRow,
  publicLinkIn,
  recordPayment,
  sendInvoice,
} from "./helpers/invoices";
import { waitForEmail } from "./helpers/mail";
import { billableOn, setWorkspaceRate, totalRow } from "./helpers/money";
import { openReport } from "./helpers/reports";
import { addManualEntry, pickProject } from "./helpers/tracker";

/**
 * Invoicing (Phase 6d): owners and admins bill a client from the report
 * engine, send a frozen PDF with a public link, and record payments.
 */

const tracker = async (page: Page, slug: string) => {
  await page.goto(`/w/${slug}/tracker`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
};

async function billable(
  page: Page,
  project: string,
  description: string,
  start: string,
  duration: string,
) {
  await pickProject(page, project);
  await billableOn(page);
  await addManualEntry(page, { description, start, duration });
}

test.describe("invoices", () => {
  test("an invoice imported from this week's billable time equals the Summary report", async ({
    page,
    freshUser,
  }) => {
    const { slug } = freshUser;
    await setWorkspaceRate(page, slug, "50");
    await createClientViaUi(page, slug, "Acme", { email: uniqueEmail("acme") });
    await createProjectViaUi(page, slug, "Website", { client: "Acme" });
    await tracker(page, slug);
    await billable(page, "Website", "Build", "00:05", "1");
    await billable(page, "Website", "Review", "01:10", "0.5");
    await openReport(page, slug, "summary");
    await expect(totalRow(page)).toContainText("$75.00");

    const number = await createInvoice(page, slug, "Acme");
    expect(number).toBe("INV-0001");
    await importTime(page, { groupBy: "Project" });
    const line = lineRow(page, "Website");
    await expect(line).toContainText("1.50");
    await expect(line).toContainText("$75.00");
    await expect(invoiceTotal(page)).toHaveText("$75.00");

    // The imported time is read-only, and says why.
    await tracker(page, slug);
    const build = page.getByRole("group", { name: "Entry Build" });
    await expect(build.getByRole("img", { name: "On invoice INV-0001" })).toBeVisible();
    await expect(build.getByRole("textbox", { name: "Description" })).toBeDisabled();
    await openReport(page, slug, "detailed");
    await expect(page.getByRole("row", { name: /Build/ })).toContainText("Invoiced");
  });

  test("sending freezes the invoice, the public link shows it, and a payment moves the balance", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug } = freshUser;
    const billing = uniqueEmail("acme");
    await createClientViaUi(page, slug, "Acme", { email: billing });
    const number = await createInvoice(page, slug, "Acme");
    await addLine(page, { description: "Design", quantity: "2", unitPrice: "100" });
    await expect(invoiceTotal(page)).toHaveText("$200.00");
    await sendInvoice(page, { email: true });
    await expect(invoiceStatus(page)).toHaveText("Sent");

    const mail = await waitForEmail(billing, { subject: new RegExp(`Invoice ${number}`) });
    const link = publicLinkIn(mail.Text || mail.HTML);
    const anon = await browser.newContext({ ...test.info().project.use, baseURL });
    try {
      const client = await anon.newPage();
      await client.goto(link);
      await expect(client.getByRole("heading", { name: `Invoice ${number}` })).toBeVisible();
      await expect(client.getByText("$200.00").first()).toBeVisible();
      const pdf = await anon.request.get(`${link}/pdf`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");
      const again = await anon.request.get(`${link}/pdf`, { maxRedirects: 0 });
      expect(again.status()).toBe(429);
    } finally {
      await anon.close();
    }

    await recordPayment(page, "50");
    await expect(invoiceStatus(page)).toHaveText("Partially paid");
    await expect(invoiceBalance(page)).toHaveText("$150.00");
    await recordPayment(page, "150");
    await expect(invoiceStatus(page)).toHaveText("Paid");
  });

  test("a member and a manager see no Invoices page", async ({ page, demoUser }) => {
    for (const who of ["manager", "member2"] as const) {
      await demoUser(who);
      await page.goto("/w/demo/tracker");
      await waitForApp(page);
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Time Tracker" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Invoices" })).toHaveCount(0);
      await page.goto("/w/demo/invoices");
      await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
      expect((await page.request.get("/api/w/demo/invoices")).status()).toBe(403);
    }
  });
});
