import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { createClientViaUi, createProjectViaUi, projectRow, rowAction } from "./helpers/catalog";
import {
  addManualEntry,
  entry,
  pickTask,
  projectButton,
  runTimer,
  tagsButton,
  timer,
  today,
} from "./helpers/tracker";

/** The project-and-task picker in the timer bar and entry rows, and who sees what in it. */

async function addTaskViaUi(page: Page, slug: string, project: string, task: string) {
  await page.goto(`/w/${slug}/projects`);
  await projectRow(page, project).getByRole("link", { name: project }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Name").fill(task);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(task) })).toBeVisible();
}

test.describe("project and task picker", () => {
  test("pick a task and the entry shows project and task", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await addTaskViaUi(page, freshUser.slug, "Website", "Design");
    await trackerPage();
    await pickTask(page, "Website", "Design");
    await runTimer(page, "Site work");
    await expect(
      entry(page, "Site work").getByRole("button", { name: /^Project:/ }),
    ).toHaveAccessibleName("Project: Website › Design");

    // Autocomplete brings the task back with the project.
    await expect(projectButton(page)).toHaveAccessibleName("Project: none");
    const description = timer(page).getByRole("combobox", { name: "Description" });
    await description.fill("Site");
    await page.getByRole("option", { name: /Site work/ }).click();
    await expect(projectButton(page)).toHaveAccessibleName("Project: Website › Design");
  });

  test("search the picker by task name", async ({ page, freshUser, trackerPage }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await createProjectViaUi(page, freshUser.slug, "App");
    await addTaskViaUi(page, freshUser.slug, "Website", "Design");
    await trackerPage();
    await projectButton(page).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill("des");
    await expect(page.getByRole("option", { name: "Website › Design", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "App", exact: true })).toHaveCount(0);
  });

  test("the picker groups projects by client with favourites first", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createClientViaUi(page, freshUser.slug, "Acme Corp");
    await createClientViaUi(page, freshUser.slug, "Globex");
    await createProjectViaUi(page, freshUser.slug, "Alpha", { client: "Acme Corp" });
    await createProjectViaUi(page, freshUser.slug, "Beta", { client: "Globex" });
    await createProjectViaUi(page, freshUser.slug, "Zeta");
    await createProjectViaUi(page, freshUser.slug, "Omega");
    await page.getByRole("button", { name: "Favourite Zeta" }).click();
    // The star flips at once and is disabled until the save lands.
    await expect(page.getByRole("button", { name: "Unfavourite Zeta" })).toBeEnabled();

    await trackerPage();
    await projectButton(page).click();
    const listbox = page.getByRole("listbox");
    // "No project" comes first; the first project offered is the favourite.
    await expect(listbox.getByRole("option").nth(1)).toHaveAccessibleName("Zeta");
    await expect(listbox.locator("[cmdk-group-heading]")).toHaveText([
      "Favourites",
      "Acme Corp",
      "Globex",
      "No client",
    ]);
  });

  test("a member cannot see or pick a private project they are not on", async ({
    page,
    demoUser,
  }) => {
    await demoUser("member2");
    await page.goto("/w/demo/tracker");
    await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
    await projectButton(page).click();
    await expect(page.getByRole("option", { name: "Internal", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Mobile app", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/w/demo/projects");
    await expect(projectRow(page, "Internal")).toBeVisible();
    await expect(projectRow(page, "Mobile app")).toHaveCount(0);

    await demoUser("member1");
    await page.goto("/w/demo/tracker");
    await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
    await projectButton(page).click();
    await expect(page.getByRole("option", { name: "Mobile app", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Mobile app › iOS", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/w/demo/projects");
    await expect(projectRow(page, "Mobile app")).toBeVisible();
  });

  test("members cannot create projects or tags from the pickers", async ({ page, demoUser }) => {
    await demoUser("member1");
    await page.goto("/w/demo/tracker");
    await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
    await projectButton(page).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill("Brand new project");
    await expect(page.getByRole("option", { name: /Create project/ })).toHaveCount(0);
    await expect(page.getByText("No projects found.")).toBeVisible();
    await page.keyboard.press("Escape");

    await tagsButton(page).click();
    await page.getByRole("combobox", { name: "Search tags" }).fill("brandnewtag");
    await expect(page.getByRole("option", { name: /Create tag/ })).toHaveCount(0);
  });

  test("a done task takes no new time and is hidden from the picker", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await addTaskViaUi(page, freshUser.slug, "Website", "QA");
    await trackerPage();
    await pickTask(page, "Website", "QA");
    await addManualEntry(page, { description: "QA work", start: "00:05", duration: "1" });

    await page.goto(`/w/${freshUser.slug}/projects`);
    await projectRow(page, "Website").getByRole("link", { name: "Website" }).click();
    await rowAction(page, page.getByRole("row", { name: /QA/ }), "Mark done");
    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();

    await trackerPage();
    await expect(
      entry(page, "QA work").getByRole("button", { name: /^Project:/ }),
    ).toHaveAccessibleName("Project: Website › QA");
    await projectButton(page).click();
    await expect(page.getByRole("option", { name: "Website", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Website › QA", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await today(page).getByRole("button", { name: 'Continue "QA work"' }).click();
    await expect(page.getByText("This task is done.")).toBeVisible();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();
  });

  test("delete a task; its entries keep the project", async ({ page, freshUser, trackerPage }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await addTaskViaUi(page, freshUser.slug, "Website", "Design");
    await trackerPage();
    await pickTask(page, "Website", "Design");
    await addManualEntry(page, { description: "Design work", start: "00:05", duration: "1" });

    await page.goto(`/w/${freshUser.slug}/projects`);
    await projectRow(page, "Website").getByRole("link", { name: "Website" }).click();
    await rowAction(page, page.getByRole("row", { name: /Design/ }), "Delete");
    const confirm = page.getByRole("alertdialog", { name: "Delete task?" });
    await expect(confirm).toContainText("1 entry keeps the project");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("row", { name: /Design/ })).toHaveCount(0);

    await trackerPage();
    await expect(
      entry(page, "Design work").getByRole("button", { name: /^Project:/ }),
    ).toHaveAccessibleName("Project: Website");
  });
});
