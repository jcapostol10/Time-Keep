import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  createProject,
  createTag,
  entry,
  projectButton,
  runTimer,
  tagsButton,
  timer,
  waitForSaves,
} from "./helpers/tracker";

/** Timer bar controls: pickers, billable, autocomplete and keyboard shortcuts. */

/** Delays only the create-project/tag server actions, as on a distant server. */
async function slowCreates(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const isCreate =
      request.method() === "POST" &&
      request.headers()["next-action"] !== undefined &&
      (request.postData() ?? "").includes('"name":');
    if (isCreate) await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fallback();
  });
}

test.describe("timer bar", () => {
  test("create a project inline and start a timer on it", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await createProject(page, "Website");
    await runTimer(page, "Site work");
    await expect(
      entry(page, "Site work").getByRole("button", { name: /^Project:/ }),
    ).toHaveAccessibleName("Project: Website");
  });

  test("search the project picker and clear the project", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await createProject(page, "Alpha");
    await createProject(page, "Beta");

    await projectButton(page).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill("bet");
    await expect(page.getByRole("option", { name: "Beta", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Alpha", exact: true })).toHaveCount(0);
    await page.getByRole("option", { name: "Beta", exact: true }).click();
    await expect(projectButton(page)).toHaveAccessibleName("Project: Beta");

    await projectButton(page).click();
    await page.getByRole("option", { name: "No project" }).click();
    await expect(projectButton(page)).toHaveAccessibleName("Project: none");
  });

  test("pick several tags, including one created inline", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await tagsButton(page).click();
    const search = page.getByRole("combobox", { name: "Search tags" });
    await search.fill("design");
    await page.getByRole("option", { name: "Create tag “design”" }).click();
    await search.fill("review");
    await page.getByRole("option", { name: "Create tag “review”" }).click();
    await page.keyboard.press("Escape");
    await expect(tagsButton(page)).toHaveAccessibleName("Tags: design, review");

    await runTimer(page, "Tagged work");
    await expect(
      entry(page, "Tagged work").getByRole("button", { name: /^Tags:/ }),
    ).toHaveAccessibleName("Tags: design, review");
  });

  test("the billable toggle is saved with the entry", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    const billable = timer(page).getByRole("button", { name: "Billable", exact: true });
    await expect(billable).toHaveAttribute("aria-pressed", "false");
    await billable.click();
    await expect(billable).toHaveAttribute("aria-pressed", "true");

    await runTimer(page, "Billable work");
    await expect(
      entry(page, "Billable work").getByRole("button", { name: "Billable", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("autocomplete fills project, tags and billable from a recent entry", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await createProject(page, "Website");
    await createTag(page, "design");
    await timer(page).getByRole("button", { name: "Billable", exact: true }).click();
    await runTimer(page, "Design review");

    // The bar is cleared after the timer starts; pick the recent entry back.
    await expect(projectButton(page)).toHaveAccessibleName("Project: none");
    const description = timer(page).getByRole("combobox", { name: "Description" });
    await description.fill("Desi");
    await page.getByRole("option", { name: /Design review/ }).click();

    await expect(description).toHaveValue("Design review");
    await expect(projectButton(page)).toHaveAccessibleName("Project: Website");
    await expect(tagsButton(page)).toHaveAccessibleName("Tags: design");
    await expect(
      timer(page).getByRole("button", { name: "Billable", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a tag created just before Start stays on the entry", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await slowCreates(page);
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Hurried work");
    await tagsButton(page).click();
    await page.getByRole("combobox", { name: "Search tags" }).fill("design");
    await page.getByRole("option", { name: "Create tag “design”" }).click();
    await page.keyboard.press("Escape");
    await timer(page).getByRole("button", { name: "Start" }).click();

    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(tagsButton(page)).toHaveAccessibleName("Tags: design");
    await waitForSaves(page);
    await trackerPage();
    await expect(tagsButton(page)).toHaveAccessibleName("Tags: design");
  });

  test("a tag created just before a manual Add stays on the entry", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await slowCreates(page);
    await timer(page).getByRole("button", { name: "Manual mode" }).click();
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Hurried manual work");
    const start = timer(page).getByRole("textbox", { name: "Start time" });
    await start.fill("00:05");
    await start.press("Tab");
    const duration = timer(page).getByRole("textbox", { name: "Duration" });
    await duration.fill("1");
    await duration.press("Tab");
    await tagsButton(page).click();
    await page.getByRole("combobox", { name: "Search tags" }).fill("design");
    await page.getByRole("option", { name: "Create tag “design”" }).click();
    await page.keyboard.press("Escape");
    await timer(page).getByRole("button", { name: "Add" }).click();

    const tags = entry(page, "Hurried manual work").getByRole("button", { name: /^Tags:/ });
    await expect(tags).toHaveAccessibleName("Tags: design");
    await waitForSaves(page);
    await trackerPage();
    await expect(tags).toHaveAccessibleName("Tags: design");
  });

  test("a project created just before Start stays on the entry", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await slowCreates(page);
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Hurried work");
    await projectButton(page).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill("Website");
    await page.getByRole("option", { name: "Create project “Website”" }).click();
    await timer(page).getByRole("button", { name: "Start" }).click();

    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(projectButton(page)).toHaveAccessibleName("Project: Website");
    await waitForSaves(page);
    await trackerPage();
    await expect(projectButton(page)).toHaveAccessibleName("Project: Website");
  });

  test("N focuses the description and Esc leaves it", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    const description = timer(page).getByRole("combobox", { name: "Description" });
    await page.getByRole("heading", { name: "Time Tracker" }).click();
    await expect(description).not.toBeFocused();

    await page.keyboard.press("n");
    await expect(description).toBeFocused();
    await expect(description).toHaveValue("");

    await page.keyboard.press("Escape");
    await expect(description).not.toBeFocused();
  });

  test("S starts and stops the timer from another workspace page", async ({ page, freshUser }) => {
    await page.goto(`/w/${freshUser.slug}/team`);
    await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
    await expect(page).toHaveTitle("Team · TimeKeep");

    await page.keyboard.press("s");
    await expect(page).toHaveTitle(/^0:00:\d\d · /);

    await page.keyboard.press("s");
    await expect(page).toHaveTitle("Team · TimeKeep");
  });
});
