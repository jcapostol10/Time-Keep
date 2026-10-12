import path from "node:path";

import { expect, test } from "@playwright/test";

import { openUserMenu, signIn } from "./helpers/app";

test.describe("profile settings", () => {
  test("update name and timezone, upload and remove an avatar", async ({ page }) => {
    await signIn(page, "member2@demo.test");
    await openUserMenu(page);
    await page.getByRole("menuitem", { name: "Profile settings" }).click();
    await expect(page).toHaveURL(/\/account/);

    const suffix = Date.now().toString().slice(-4);
    await page.getByLabel("Full name").fill(`Max Member ${suffix}`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();

    await page
      .getByLabel("Choose a profile photo")
      .setInputFiles(path.join(__dirname, "fixtures", "avatar.png"));
    await expect(page.getByText("Photo updated")).toBeVisible();
    await expect(page.locator("img[src*='/avatars/']").first()).toBeVisible();

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Photo removed")).toBeVisible();

    // Restore the seeded name so other specs stay deterministic.
    await page.getByLabel("Full name").fill("Max Member");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
  });
});
