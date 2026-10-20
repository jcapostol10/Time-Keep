import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { createProjectViaUi, projectRow, rowAction } from "./helpers/catalog";
import { addManualEntry, pickProject } from "./helpers/tracker";

/** A project's detail pages: tasks, access, status and settings (admins only). */

async function openProject(page: Page, slug: string, name: string) {
  if (!page.url().includes(`/w/${slug}/projects`)) await page.goto(`/w/${slug}/projects`);
  await projectRow(page, name).getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole("tablist").getByRole("tab", { name });

test.describe("project detail", () => {
  test("manage a project's tasks", async ({ page, freshUser }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await openProject(page, freshUser.slug, "Website");
    await expect(tab(page, "Tasks")).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "Add task" }).click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await dialog.getByLabel("Name").fill("Design");
    await dialog.getByRole("checkbox", { name: "Fresh Tester" }).check();
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole("row", { name: /Design/ });
    await expect(row.getByRole("img", { name: "Fresh Tester" })).toBeVisible();

    await rowAction(page, row, "Rename");
    const rename = page.getByRole("dialog", { name: "Rename task" });
    await rename.getByLabel("Name").fill("Visual design");
    await rename.getByRole("button", { name: "Save changes" }).click();
    await expect(rename).toBeHidden();
    const renamed = page.getByRole("row", { name: /Visual design/ });
    await expect(renamed).toBeVisible();

    await rowAction(page, renamed, "Mark done");
    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Done tasks" }).getByRole("row", { name: /Visual design/ }),
    ).toBeVisible();

    await rowAction(page, page.getByRole("row", { name: /Visual design/ }), "Reopen");
    await expect(page.getByRole("heading", { name: "Done" })).toHaveCount(0);

    await rowAction(page, page.getByRole("row", { name: /Visual design/ }), "Delete");
    const confirm = page.getByRole("alertdialog", { name: "Delete task?" });
    await expect(confirm).toContainText("No entries");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("row", { name: /Visual design/ })).toHaveCount(0);
  });

  test("make a project private and pick its members", async ({ page, demoUser }) => {
    const name = `Private ${Date.now().toString(36)}`;
    await demoUser("owner");
    await createProjectViaUi(page, "demo", name);
    await openProject(page, "demo", name);
    await tab(page, "Access").click();

    const privateSwitch = page.getByRole("switch", { name: "Private project" });
    await expect(privateSwitch).not.toBeChecked();
    await privateSwitch.click();
    await expect(privateSwitch).toBeChecked();
    await page.getByRole("combobox", { name: "Search members" }).fill("Mia");
    await page.getByRole("option", { name: /Mia Member/ }).click();
    await expect(page.getByRole("button", { name: "Remove Mia Member" })).toBeVisible();

    await demoUser("member2");
    await page.goto("/w/demo/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(projectRow(page, name)).toHaveCount(0);

    await demoUser("member1");
    await page.goto("/w/demo/projects");
    await expect(projectRow(page, name)).toBeVisible();
  });

  test("the status tab sums time by task and member", async ({ page, freshUser, trackerPage }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await trackerPage();
    await pickProject(page, "Website");
    await addManualEntry(page, { description: "Design", start: "00:05", duration: "1" });
    await pickProject(page, "Website");
    await addManualEntry(page, { description: "Review", start: "02:05", duration: "0.5" });

    await openProject(page, freshUser.slug, "Website");
    await tab(page, "Status").click();
    await page
      .getByRole("group", { name: "Range" })
      .getByRole("button", { name: "This week" })
      .click();
    const byTask = page.getByRole("table", { name: "Time by task" });
    await expect(byTask.getByRole("row", { name: /No task/ })).toContainText("1:30:00");
    const byMember = page.getByRole("table", { name: "Time by member" });
    await expect(byMember.getByRole("row", { name: /Fresh Tester/ })).toContainText("1:30:00");
    await expect(page.getByTestId("status-total")).toHaveText("1:30:00");
  });

  test("edit project settings, mark it as a template, archive and unarchive it", async ({
    page,
    freshUser,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await openProject(page, freshUser.slug, "Website");
    await tab(page, "Settings").click();

    await page.getByLabel("Name").fill("Website v2");
    await page.getByLabel("Note").fill("Relaunch");
    await page.getByRole("switch", { name: "Use as template" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Website v2" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Use as template" })).toBeChecked();
    await expect(page.getByLabel("Note")).toHaveValue("Relaunch");

    await page.getByRole("button", { name: "Archive project" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Archived");
    await page.getByRole("button", { name: "Unarchive project" }).click();
    await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Archived");
  });

  test("the Budget and Rates tabs say which phase brings them", async ({ page, freshUser }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await openProject(page, freshUser.slug, "Website");
    await tab(page, "Budget").click();
    await expect(page.getByText(/Phase 6/)).toBeVisible();
    await tab(page, "Rates").click();
    await expect(page.getByText(/Phase 4/)).toBeVisible();
  });

  test("members cannot open project detail", async ({ page, demoUser }) => {
    await demoUser("owner");
    await page.goto("/w/demo/projects");
    const href = await projectRow(page, "Internal")
      .getByRole("link", { name: "Internal" })
      .getAttribute("href");
    expect(href).toMatch(/\/w\/demo\/projects\/.+/);

    await demoUser("member1");
    await page.goto(href!);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });
});
