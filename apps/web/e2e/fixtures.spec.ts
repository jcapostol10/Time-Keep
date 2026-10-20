import { expect, signUpFreshUser, test } from "./fixtures";

test("freshUser starts signed in on its own workspace", async ({
  page,
  freshUser,
  trackerPage,
}) => {
  await trackerPage();
  await expect(page.getByRole("heading", { name: "Time Tracker" })).toBeVisible();
  expect(page.url()).toContain(`/w/${freshUser.slug}/tracker`);
});

test("every freshUser is a new account with its own workspace", async ({
  browser,
  baseURL,
  freshUser,
}) => {
  expect(freshUser.email).toMatch(/@e2e\.test$/);
  // A second sign-up in its own cookie jar, the way the fixture runs per test.
  const other = await browser.newContext({ ...test.info().project.use, baseURL });
  try {
    const second = await signUpFreshUser(other.request, baseURL);
    expect(second.email).not.toBe(freshUser.email);
    expect(second.slug).not.toBe(freshUser.slug);
  } finally {
    await other.close();
  }
});

test("demoUser signs in as the requested role", async ({ page, demoUser }) => {
  await demoUser("admin");
  await page.goto("/w/demo/settings");
  await expect(page.getByLabel("Workspace name")).toBeEnabled();
});
