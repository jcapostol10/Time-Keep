import { expect, test } from "@playwright/test";

import { signIn, signOut, signUpAndVerify, uniqueEmail } from "./helpers/app";
import { extractAppLink, waitForEmail } from "./helpers/mailpit";

test.describe("authentication", () => {
  test("sign up, verify email, land in a personal workspace, sign out and back in", async ({
    page,
  }) => {
    const email = uniqueEmail("ada");
    await signUpAndVerify(page, "Ada Lovelace", email);

    // Personal workspace named after the first name, user is owner.
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Ada's workspace",
    );

    await signOut(page);
    await signIn(page, email);
    await expect(page.getByRole("heading", { name: "Time Tracker" })).toBeVisible();
  });

  test("unverified users cannot sign in and can resend the verification email", async ({
    page,
  }) => {
    const email = uniqueEmail("pending");
    await page.goto("/sign-up");
    await page.getByLabel("Full name").fill("Pending Person");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/check-email/);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Please verify your email address first.")).toBeVisible();
    await page.getByRole("button", { name: "Resend verification email" }).click();
    await expect(page.getByText("Verification email sent")).toBeVisible();
  });

  test("magic link signs an existing user in", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("member2@demo.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/check-email\?type=magic/);

    const message = await waitForEmail("member2@demo.test", { subject: /sign-in link/i });
    await page.goto(extractAppLink(message));
    await expect(page).toHaveURL(/\/w\/[^/]+\/tracker/);
  });

  test("forgot password sends a reset link that sets a new password", async ({ page }) => {
    const email = uniqueEmail("reset");
    await signUpAndVerify(page, "Reset Rita", email, "oldpassword1");
    await signOut(page);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page).toHaveURL(/\/check-email\?type=reset/);

    const message = await waitForEmail(email, { subject: /reset/i });
    await page.goto(extractAppLink(message));
    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await page.getByLabel("New password").fill("newpassword2");
    await page.getByLabel("Confirm password").fill("newpassword2");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await signIn(page, email, "newpassword2");
  });

  test("protected routes redirect to sign-in and preserve the destination", async ({ page }) => {
    await page.goto("/w/demo/team");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2Fdemo%2Fteam/);
    await page.getByLabel("Email").fill("owner@demo.test");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/w\/demo\/team/);
  });
});
