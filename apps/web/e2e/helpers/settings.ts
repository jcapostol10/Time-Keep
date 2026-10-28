import { expect, type Page } from "@playwright/test";

import { waitForApp } from "./app";

export async function openSettings(page: Page, slug: string) {
  await page.goto(`/w/${slug}/settings`);
  await waitForApp(page);
}

export async function saveSettings(page: Page) {
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Workspace settings saved")).toBeVisible();
}
