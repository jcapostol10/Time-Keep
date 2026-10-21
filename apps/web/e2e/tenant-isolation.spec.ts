import { expect, test } from "@playwright/test";

import { openWorkspaceSwitcher, signIn } from "./helpers/app";

test.describe("tenant isolation", () => {
  test("a member of one workspace cannot open another workspace's pages", async ({ page }) => {
    await signIn(page, "member1@demo.test");

    // The owner's personal workspace (seeded) has no other members.
    await page.goto("/w/olivia-s-workspace/tracker");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();

    await page.goto("/w/olivia-s-workspace/team");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();

    // Nonexistent slugs are indistinguishable from forbidden ones.
    await page.goto("/w/does-not-exist/tracker");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });

  test("the switcher only lists the user's own workspaces", async ({ page }) => {
    await signIn(page, "member1@demo.test");
    await openWorkspaceSwitcher(page);
    await expect(page.getByRole("menuitem", { name: /Demo Workspace/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Mia's workspace/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Olivia's workspace/ })).toHaveCount(0);
  });
});
