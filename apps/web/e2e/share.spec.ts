import { readFile } from "node:fs/promises";

import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { openReport, reportTotal } from "./helpers/reports";
import { addManualEntry } from "./helpers/tracker";

/** Share links: created from a report, opened without signing in, revoked. */

async function createShareLink(page: Page, title?: string): Promise<string> {
  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share this report" });
  if (title) await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/share\/[A-Za-z0-9_-]{43}$/);
  const url = await link.inputValue();
  await page.keyboard.press("Escape");
  return url;
}

/** A browser context with no session (as a private window), keeping a preview's bypass header. */
async function anonymousPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  return context.newPage();
}

test.describe("share links", () => {
  test("a share link opens without signing in and shows the same total", async ({
    page,
    browser,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1.25" });
    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("1:15:00");
    const url = await createShareLink(page, "Week for the client");

    const visitor = await anonymousPage(browser);
    await visitor.goto(url);
    await expect(visitor.getByRole("heading", { name: "Week for the client" })).toBeVisible();
    await expect(visitor.getByTestId("report-total")).toHaveText("1:15:00");
    await expect(visitor.getByText("No project")).toBeVisible();
    await visitor.context().close();
  });

  test("revoking a link makes it unavailable", async ({
    page,
    browser,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "summary");
    const url = await createShareLink(page, "To be revoked");

    await page.getByRole("link", { name: "Shared", exact: true }).click();
    const row = page.getByRole("row", { name: /To be revoked/ });
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("Revoked");

    const visitor = await anonymousPage(browser);
    const response = await visitor.goto(url);
    expect(response?.status()).toBe(404);
    await expect(visitor.getByText("This link is no longer available")).toBeVisible();
    await visitor.context().close();
  });

  test("the shared page exports CSV", async ({ page, browser, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "summary");
    const url = await createShareLink(page);

    const visitor = await anonymousPage(browser);
    await visitor.goto(url);
    const [download] = await Promise.all([
      visitor.waitForEvent("download"),
      visitor.getByRole("link", { name: "Download CSV" }).click(),
    ]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain("No project,1:00:00");
    await visitor.context().close();
  });

  test("the share title names the report and its range", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await openReport(page, freshUser.slug, "summary");
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog", { name: "Share this report" });
    await expect(dialog.getByLabel("Title")).toHaveValue("Summary report · This week");
  });

  test("a shared link refuses a second export within seconds", async ({
    page,
    browser,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "summary");
    const url = await createShareLink(page);

    const visitor = await anonymousPage(browser);
    const first = await visitor.request.get(`${url}/export?format=csv`);
    expect(first.status()).toBe(200);
    const second = await visitor.request.get(`${url}/export?format=pdf`);
    expect(second.status()).toBe(429);
    expect(await second.text()).toContain("Try again in a few seconds");
    await visitor.context().close();
  });
});
