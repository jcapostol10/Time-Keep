import { expect, type Page } from "@playwright/test";

import { waitForApp } from "./app";
import { setRateIn, waitForRecalc } from "./rates";
import { memberAction, openTeam } from "./team";
import { timer } from "./tracker";

/** Actions shared by the cost, profit and currency specs (Phase 6a). */

/** The workspace's billable rate, applied to every entry (waits for the job). */
export async function setWorkspaceRate(page: Page, slug: string, amount: string) {
  await page.goto(`/w/${slug}/settings`);
  await waitForApp(page);
  await setRateIn(
    page,
    page
      .getByRole("region", { name: "Billable rate" })
      .getByRole("button", { name: "Change rate" }),
    { amount, apply: "All entries, past and future" },
  );
  await waitForRecalc(page);
}

/** A member's cost rate from the Team page's row menu, applied to every entry. */
export async function setCostRate(page: Page, slug: string, name: string, amount: string) {
  await openTeam(page, slug);
  await memberAction(page, name, "Cost rate");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /^Hourly cost/ }).fill(amount);
  await dialog.getByRole("radio", { name: "All entries, past and future" }).click();
  await dialog.getByRole("button", { name: "Save rate" }).click();
  await expect(dialog).toBeHidden();
  await waitForRecalc(page);
}

/** Switches the timer bar's Billable toggle on. */
export async function billableOn(page: Page) {
  const billable = timer(page).getByRole("button", { name: "Billable", exact: true });
  if ((await billable.getAttribute("aria-pressed")) !== "true") await billable.click();
  await expect(billable).toHaveAttribute("aria-pressed", "true");
}

/** A client with its own currency ("EUR"), through the Clients page dialog. */
export async function createClientIn(page: Page, slug: string, name: string, currency: string) {
  await page.goto(`/w/${slug}/clients`);
  await waitForApp(page);
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog", { name: "New client" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("combobox", { name: "Currency" }).click();
  await page.getByRole("option", { name: new RegExp(`^${currency}\\b`) }).click();
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(dialog).toBeHidden();
}

/** Opens a project's Rates tab from the Projects page. */
export async function openProjectRates(page: Page, slug: string, project: string) {
  await page.goto(`/w/${slug}/projects`);
  await waitForApp(page);
  await page.getByRole("link", { name: project, exact: true }).click();
  await page.getByRole("tab", { name: "Rates" }).click();
  await expect(page.getByRole("region", { name: "Project rate" })).toBeVisible();
}

/** The Summary (or Profit) table's Total row. */
export const totalRow = (page: Page) => page.getByRole("row").filter({ hasText: /^Total/ });
