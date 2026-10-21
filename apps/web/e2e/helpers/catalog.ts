import { expect, type Page } from "@playwright/test";

import { waitForApp } from "./app";

/** Actions on the Clients, Projects and Tags pages shared by the catalog specs. */

export const clientRow = (page: Page, name: string) =>
  page.getByRole("row", { name: new RegExp(`^${escapeRegExp(name)}\\b`) });

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Creates a client through the Clients page dialog and waits for its row. */
export async function createClientViaUi(
  page: Page,
  slug: string,
  name: string,
  extra: { email?: string; notes?: string } = {},
) {
  if (!page.url().includes(`/w/${slug}/clients`)) await page.goto(`/w/${slug}/clients`);
  await waitForApp(page);
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog", { name: "New client" });
  await dialog.getByLabel("Name").fill(name);
  if (extra.email) await dialog.getByLabel("Email").fill(extra.email);
  if (extra.notes) await dialog.getByLabel("Notes").fill(extra.notes);
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(dialog).toBeHidden();
  await expect(clientRow(page, name)).toBeVisible();
}

/**
 * Opens the "More actions" menu of a row and clicks an item. A re-render that
 * lands right after the menu opens (a server action's revalidation followed by
 * router.refresh) can close it again; a person would reopen it, so this retries.
 */
export async function rowAction(page: Page, row: ReturnType<Page["getByRole"]>, item: string) {
  await expect(async () => {
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: item }).click({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

/** The row whose name cell is the project (the cell also carries an "Archived" badge in that view). */
export const projectRow = (page: Page, name: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { name: new RegExp(`^${escapeRegExp(name)}( Archived)?$`) }),
  });

/** Creates a project through the Projects page dialog and waits for its row. */
export async function createProjectViaUi(
  page: Page,
  slug: string,
  name: string,
  opts: {
    client?: string;
    visibility?: "Public" | "Private";
    billable?: boolean;
    color?: string;
  } = {},
) {
  if (!page.url().includes(`/w/${slug}/projects`)) await page.goto(`/w/${slug}/projects`);
  await waitForApp(page);
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill(name);
  if (opts.client) {
    await dialog.getByRole("combobox", { name: "Client" }).click();
    await page.getByRole("option", { name: opts.client, exact: true }).click();
  }
  if (opts.color) await dialog.getByRole("radio", { name: opts.color }).click();
  if (opts.billable === false)
    await dialog.getByRole("switch", { name: "Billable by default" }).click();
  if (opts.visibility) await dialog.getByRole("radio", { name: opts.visibility }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
  // With a client, the row that carries it: the same name may already exist
  // under another client, and two matches would be a strict-mode violation.
  const row = opts.client
    ? projectRow(page, name).filter({
        has: page.getByRole("cell", { name: opts.client, exact: true }),
      })
    : projectRow(page, name);
  await expect(row).toBeVisible();
}
