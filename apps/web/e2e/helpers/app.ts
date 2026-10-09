import { expect, type Page } from "@playwright/test";

import { extractAppLink, waitForEmail } from "./mailpit";

export const DEMO_PASSWORD = "password123";

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@e2e.test`;
}

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/tracker/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/** Sign up, open the verification email from Mailpit and land in the new workspace. */
export async function signUpAndVerify(
  page: Page,
  name: string,
  email: string,
  password = DEMO_PASSWORD,
) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/check-email\?type=verify/);

  const message = await waitForEmail(email, { subject: /verify/i });
  await page.goto(extractAppLink(message));
  await expect(page).toHaveURL(/\/w\/[^/]+\/tracker/);
}

export function workspaceSlugFromUrl(page: Page): string {
  const match = page.url().match(/\/w\/([^/]+)/);
  if (!match?.[1]) throw new Error(`Not on a workspace page: ${page.url()}`);
  return match[1];
}
