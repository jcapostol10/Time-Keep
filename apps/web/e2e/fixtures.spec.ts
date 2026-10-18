import { expect, test } from "./fixtures";

let firstEmail: string | undefined;

test("freshUser starts signed in on its own workspace", async ({
  page,
  freshUser,
  trackerPage,
}) => {
  await trackerPage();
  await expect(page.getByRole("heading", { name: "Time Tracker" })).toBeVisible();
  expect(page.url()).toContain(`/w/${freshUser.slug}/tracker`);
  firstEmail = freshUser.email;
});

test("two tests get different fresh users", async ({ freshUser }) => {
  expect(freshUser.email).toMatch(/@e2e\.test$/);
  expect(firstEmail).toBeDefined();
  expect(freshUser.email).not.toBe(firstEmail);
});

test("demoUser signs in as the requested role", async ({ page, demoUser }) => {
  await demoUser("admin");
  await page.goto("/w/demo/settings");
  await expect(page.getByLabel("Workspace name")).toBeEnabled();
});
