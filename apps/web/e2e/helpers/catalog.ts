import { expect, type Page } from "@playwright/test";

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
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog", { name: "New client" });
  await dialog.getByLabel("Name").fill(name);
  if (extra.email) await dialog.getByLabel("Email").fill(extra.email);
  if (extra.notes) await dialog.getByLabel("Notes").fill(extra.notes);
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(dialog).toBeHidden();
  await expect(clientRow(page, name)).toBeVisible();
}

/** Opens the "More actions" menu of a row and clicks an item. */
export async function rowAction(page: Page, row: ReturnType<Page["getByRole"]>, item: string) {
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
