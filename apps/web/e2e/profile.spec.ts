import path from "node:path";

import { expect, test } from "./fixtures";

import { openUserMenu, signIn } from "./helpers/app";
import { waitForEmail } from "./helpers/mail";

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

    // Restore the seeded name so other specs stay deterministic. The first save's toast
    // can still be up on a quick machine; let it go so the next one is the only one.
    await expect(page.getByText("Profile saved")).toBeHidden();
    await page.getByLabel("Full name").fill("Max Member");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
  });

  test("send a test email", async ({ page, freshUser }) => {
    await page.goto("/account");
    await page.getByRole("button", { name: "Send me a test email" }).click();
    await expect(page.getByText(`Test email sent to ${freshUser.email}`)).toBeVisible();
    const message = await waitForEmail(freshUser.email, { subject: /test email/i });
    expect(message.Text).toContain(`reach you at ${freshUser.email}`);
    // A second one right away is refused: the provider quota is everyone's mail.
    await page.getByRole("button", { name: "Send me a test email" }).click();
    await expect(page.getByText(/You can send another test email in/)).toBeVisible();
  });
});
