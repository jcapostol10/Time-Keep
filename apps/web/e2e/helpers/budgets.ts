import { expect, type Locator, type Page } from "@playwright/test";

import { waitForApp } from "./app";
import { projectRow } from "./catalog";

/** Actions on a project's Budget tab (Phase 6b). */

/** Opens a project's Budget tab from the Projects page. */
export async function openBudget(page: Page, slug: string, project: string) {
  await page.goto(`/w/${slug}/projects`);
  await waitForApp(page);
  await projectRow(page, project).getByRole("link", { name: project }).click();
  await page.getByRole("tab", { name: "Budget" }).click();
  await expect(page.getByRole("heading", { name: "Estimate", exact: true })).toBeVisible();
  await waitForApp(page);
}

/** Fills the Budget tab's estimate form and saves it. */
export async function setEstimate(
  page: Page,
  opts: {
    kind: "Time" | "Money";
    /** Hours, or an amount in the project's currency. */
    amount: string;
    period?: "Whole project" | "Every month";
    alerts?: boolean;
  },
) {
  const form = page.getByRole("form", { name: "Estimate" });
  await form.getByRole("radio", { name: opts.kind, exact: true }).click();
  await form
    .getByRole("textbox", { name: opts.kind === "Time" ? "Hours" : /^Amount/ })
    .fill(opts.amount);
  if (opts.period) {
    await form.getByRole("combobox", { name: "Period" }).click();
    await page.getByRole("option", { name: opts.period, exact: true }).click();
  }
  if (opts.alerts !== undefined) {
    const alerts = form.getByRole("switch", { name: "Email alerts" });
    if ((await alerts.getAttribute("aria-checked")) !== String(opts.alerts)) await alerts.click();
  }
  await form.getByRole("button", { name: "Save estimate" }).click();
  await expect(page.getByText("Estimate saved")).toBeVisible();
}

/** The whole percent a progress bar shows. */
export async function barPercent(bar: Locator): Promise<number> {
  await expect(bar).toBeVisible();
  return Number(await bar.getAttribute("aria-valuenow"));
}
