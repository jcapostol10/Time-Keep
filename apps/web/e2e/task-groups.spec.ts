import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { openCalendar } from "./helpers/calendar";
import { addTaskViaUi, createProjectViaUi, projectRow, rowAction } from "./helpers/catalog";
import { openSettings } from "./helpers/settings";
import { addTeammate, memberAction, openTeam } from "./helpers/team";
import {
  addManualEntry,
  entry,
  pickProject,
  pickTask,
  projectButton,
  timer,
  today,
} from "./helpers/tracker";

/**
 * Tasks by group (decision 11): a task belongs to groups, and with the
 * "Task visibility" setting on "By group" members see and track only their
 * groups' tasks.
 */

async function openTracker(page: Page, slug: string) {
  await page.goto(`/w/${slug}/tracker`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
}

async function createGroup(page: Page, slug: string, name: string) {
  await openTeam(page, slug);
  await page.getByRole("tab", { name: "Groups" }).click();
  await page.getByRole("button", { name: "New group" }).click();
  const dialog = page.getByRole("dialog", { name: "New group" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: `Actions for ${name}` })).toBeVisible();
}

/** Ticks or unticks people in the group's "Members of" dialog (the Groups tab must be open). */
async function setGroupMembers(page: Page, group: string, members: Record<string, boolean>) {
  await page.getByRole("button", { name: `Actions for ${group}` }).click();
  await page.getByRole("menuitem", { name: "Members" }).click();
  const dialog = page.getByRole("dialog", { name: `Members of ${group}` });
  for (const [name, on] of Object.entries(members)) {
    await dialog.getByRole("checkbox", { name }).setChecked(on);
  }
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

/** Switches the setting; "By group" confirms first and `confirmText` is what the dialog says. */
async function setTaskVisibility(
  page: Page,
  slug: string,
  option: "Everyone" | "By group",
  confirmText?: string,
) {
  await openSettings(page, slug);
  await page.getByRole("combobox", { name: "Task visibility", exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  if (option === "By group") {
    const confirm = page.getByRole("alertdialog", { name: "Show tasks by group?" });
    if (confirmText) await expect(confirm).toContainText(confirmText);
    await confirm.getByRole("button", { name: "Switch to by group" }).click();
  }
  await expect(page.getByText("Workspace settings saved")).toBeVisible();
}

async function openTasksTab(page: Page, slug: string, project: string) {
  await page.goto(`/w/${slug}/projects`);
  await waitForApp(page);
  await projectRow(page, project).getByRole("link", { name: project }).click();
  await waitForApp(page);
  await expect(page.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "true");
}

/** The accessible names of the options a picker lists ("Web › Design" for a task), then closes it. */
async function pickerOptions(page: Page, trigger: ReturnType<Page["getByRole"]>) {
  await trigger.click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const names = await options.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""),
  );
  await page.keyboard.press("Escape");
  return names.filter((n) => n && !n.startsWith("Create "));
}

test.describe("tasks by group", () => {
  // Each flow sets up groups, projects and tasks through the UI and walks several pages.
  test.describe.configure({ timeout: 180_000 });

  test("an admin turns on task visibility by group and assigns groups to tasks", async ({
    page,
    freshUser,
  }) => {
    const slug = freshUser.slug;
    await createProjectViaUi(page, slug, "Web");
    for (const t of ["Design", "Dev", "Admin"]) await addTaskViaUi(page, slug, "Web", t);
    await createProjectViaUi(page, slug, "Vault", { visibility: "Private" });
    await addTaskViaUi(page, slug, "Vault", "Audit");
    await createGroup(page, slug, "Design");
    await createGroup(page, slug, "Finance");

    await setTaskVisibility(page, slug, "By group", "4 active tasks have no group yet.");

    await openTasksTab(page, slug, "Web");
    await expect(page.getByRole("status")).toContainText("3 active tasks have no group.");
    await expect(page.getByText("No group", { exact: true })).toHaveCount(3);

    // A task with no group can still be renamed without picking one.
    await rowAction(page, page.getByRole("row", { name: /^Select Admin/ }), "Rename");
    const rename = page.getByRole("dialog", { name: "Rename task" });
    await rename.getByLabel("Name").fill("Admin work");
    await rename.getByRole("button", { name: "Save changes" }).click();
    await expect(rename).toBeHidden();
    await expect(page.getByRole("row", { name: /^Select Admin work/ })).toBeVisible();

    await page.getByRole("checkbox", { name: "Select Design" }).check();
    await page.getByRole("checkbox", { name: "Select Dev" }).check();
    const actions = page.getByRole("toolbar", { name: "Task actions" });
    await actions.getByRole("button", { name: "Add to groups…" }).click();
    const add = page.getByRole("dialog", { name: "Add 2 tasks to groups" });
    await add.getByRole("checkbox", { name: "Design" }).check();
    await add.getByRole("button", { name: "Apply" }).click();
    await expect(add).toBeHidden();
    await expect(page.getByRole("row", { name: /^Select Design/ })).toContainText("Design");
    await expect(page.getByRole("row", { name: /^Select Dev/ })).toContainText("Design");
    await expect(page.getByRole("status")).toContainText("1 active task has no group.");
    await expect(page.getByText("No group", { exact: true })).toHaveCount(1);

    await page.getByRole("checkbox", { name: "No group only" }).check();
    await expect(page.getByRole("row", { name: /Admin/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /^Select Dev/ })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "No group only" }).uncheck();

    // Rule 9: a group given a task on a private project gets the project's access.
    await openTasksTab(page, slug, "Vault");
    await page.getByRole("checkbox", { name: "Select Audit" }).check();
    await page
      .getByRole("toolbar", { name: "Task actions" })
      .getByRole("button", { name: "Add to groups…" })
      .click();
    const vault = page.getByRole("dialog", { name: "Add 1 task to groups" });
    await expect(vault).toContainText("These groups will also get access to this private project.");
    await vault.getByRole("checkbox", { name: "Finance" }).check();
    await vault.getByRole("button", { name: "Apply" }).click();
    await expect(vault).toBeHidden();
    // The chip lands with the refresh; a tab click during that refresh can be
    // dropped (the double render in docs/BACKLOG.md), so the click is retried.
    await expect(page.getByRole("row", { name: /^Select Audit/ })).toContainText("Finance");
    await expect(async () => {
      await page.getByRole("tab", { name: "Access" }).click();
      await expect(page.getByRole("checkbox", { name: "Finance" })).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("checkbox", { name: "Finance" })).toBeChecked();

    // With tasks by group, a new task needs a group.
    await openTasksTab(page, slug, "Web");
    await page.getByRole("button", { name: "Add task" }).click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await dialog.getByLabel("Name").fill("Review");
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toContainText("Pick at least one group.");
    await dialog.getByRole("checkbox", { name: "Design" }).check();
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row", { name: /^Select Review/ })).toContainText("Design");
  });

  test("a member in two groups sees exactly their groups' tasks and loses them on leaving", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const slug = freshUser.slug;
    for (const g of ["Design", "Engineering", "Finance"]) await createGroup(page, slug, g);
    await createProjectViaUi(page, slug, "Web");
    await addTaskViaUi(page, slug, "Web", "Design", ["Design"]);
    await addTaskViaUi(page, slug, "Web", "Dev", ["Engineering"]);
    await addTaskViaUi(page, slug, "Web", "Books", ["Finance"]);
    await createProjectViaUi(page, slug, "Ops");
    await addTaskViaUi(page, slug, "Ops", "Ledger", ["Finance"]);
    await createProjectViaUi(page, slug, "Empty");
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await openTeam(page, slug);
    await page.getByRole("tab", { name: "Groups" }).click();
    await setGroupMembers(page, "Design", { "Mia Member": true });
    await setGroupMembers(page, "Engineering", { "Mia Member": true });
    await setTaskVisibility(page, slug, "By group", "Every active task already has a group.");

    // The tracker's picker: Design's and Engineering's tasks, Empty, and no Ops.
    await openTracker(mia.page, slug);
    const tracker = await pickerOptions(mia.page, projectButton(mia.page));
    expect(tracker).toEqual(expect.arrayContaining(["Web", "Web › Design", "Web › Dev", "Empty"]));
    expect(tracker).not.toEqual(expect.arrayContaining(["Web › Books"]));
    expect(tracker).not.toEqual(expect.arrayContaining(["Ops"]));

    // The timesheet's "Add row" picker lists the same.
    await mia.page.goto(`/w/${slug}/timesheet`);
    await expect(mia.page.locator('[role="grid"][data-hydrated="true"]')).toBeVisible();
    await mia.page.getByRole("button", { name: "Add new row" }).click();
    const addRow = mia.page.getByRole("dialog", { name: "Add row" });
    const sheet = await pickerOptions(mia.page, addRow.getByRole("button", { name: /^Project:/ }));
    expect(sheet).toEqual(expect.arrayContaining(["Web › Design", "Web › Dev"]));
    expect(sheet).not.toEqual(expect.arrayContaining(["Web › Books", "Ops"]));
    await mia.page.keyboard.press("Escape");
    await expect(addRow).toBeHidden();

    // Rule 8: on Web, Stop needs a task; with one, the entry saves.
    await openTracker(mia.page, slug);
    await pickProject(mia.page, "Web");
    await timer(mia.page).getByRole("combobox", { name: "Description" }).fill("Dev work");
    await timer(mia.page).getByRole("button", { name: "Start" }).click();
    await expect(timer(mia.page).getByRole("button", { name: "Stop" })).toBeVisible();
    await timer(mia.page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(mia.page).getByRole("alert")).toContainText("Task is required.");
    await expect(timer(mia.page).getByRole("button", { name: "Stop" })).toBeVisible();
    await pickTask(mia.page, "Web", "Dev");
    await timer(mia.page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(mia.page).getByRole("button", { name: "Start" })).toBeVisible();
    await expect(entry(mia.page, "Dev work")).toBeVisible();
    // A longer entry for the calendar (a one-second block is too small to click).
    await pickTask(mia.page, "Web", "Dev");
    await addManualEntry(mia.page, { description: "Calendar work", start: "00:05", duration: "1" });
    await expect(entry(mia.page, "Calendar work")).toBeVisible();

    // The bulk-edit and calendar pickers list the same.
    await today(mia.page).getByRole("checkbox", { name: "Select all entries for Today" }).check();
    await mia.page
      .getByRole("toolbar", { name: "Bulk actions" })
      .getByRole("button", { name: "Edit" })
      .click();
    const bulk = mia.page.getByRole("dialog", { name: "Edit 2 entries" });
    await bulk.getByRole("checkbox", { name: "Change project" }).check();
    const bulkOptions = await pickerOptions(
      mia.page,
      bulk.getByRole("button", { name: /^Project:/ }),
    );
    expect(bulkOptions).toEqual(expect.arrayContaining(["Web › Design", "Web › Dev"]));
    expect(bulkOptions).not.toEqual(expect.arrayContaining(["Web › Books", "Ops"]));
    await mia.page.keyboard.press("Escape");
    await expect(bulk).toBeHidden();
    await openCalendar(mia.page, slug, "week");
    await mia.page.getByRole("button", { name: /^Calendar work, Web/ }).click();
    const edit = mia.page.getByRole("dialog", { name: "Edit entry" });
    const calendarOptions = await pickerOptions(
      mia.page,
      edit.getByRole("button", { name: /^Project:/ }),
    );
    expect(calendarOptions).toEqual(expect.arrayContaining(["Web › Design", "Web › Dev"]));
    expect(calendarOptions).not.toEqual(expect.arrayContaining(["Web › Books", "Ops"]));
    await mia.page.keyboard.press("Escape");
    await expect(edit).toBeHidden();

    // The Team page answers "which tasks does a group give" and "what can she see".
    await openTeam(page, slug);
    await page.getByRole("tab", { name: "Groups" }).click();
    await page.getByRole("button", { name: "Actions for Engineering" }).click();
    await page.getByRole("menuitem", { name: "Tasks" }).click();
    const groupTasks = page.getByRole("dialog", { name: "Tasks for Engineering" });
    await expect(groupTasks).toContainText("Web: Dev");
    await page.keyboard.press("Escape");
    await expect(groupTasks).toBeHidden();
    await page.getByRole("tab", { name: "Members" }).click();
    await memberAction(page, "Mia Member", "Tasks available");
    const available = page.getByRole("dialog", { name: "Tasks available to Mia Member" });
    await expect(available).toContainText("Web: Design, Dev");
    await page.keyboard.press("Escape");
    await expect(available).toBeHidden();

    // Leaving Engineering hides Dev at once; the old entry stays and Continue is refused.
    await page.getByRole("tab", { name: "Groups" }).click();
    await setGroupMembers(page, "Engineering", { "Mia Member": false });
    await openTracker(mia.page, slug);
    const after = await pickerOptions(mia.page, projectButton(mia.page));
    expect(after).toEqual(expect.arrayContaining(["Web › Design"]));
    expect(after).not.toEqual(expect.arrayContaining(["Web › Dev"]));
    await expect(entry(mia.page, "Dev work")).toBeVisible();
    await expect(
      entry(mia.page, "Dev work").getByRole("button", { name: "Project: Web › Dev" }),
    ).toBeVisible();
    await today(mia.page).getByRole("button", { name: 'Continue "Dev work"' }).click();
    await expect(mia.page.getByText("This task isn't available to your groups.")).toBeVisible();
    await expect(timer(mia.page).getByRole("button", { name: "Start" })).toBeVisible();
    await mia.context.close();
  });

  test("a new invitee invited into a group sees its tasks on first sign-in", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const slug = freshUser.slug;
    await createGroup(page, slug, "Finance");
    await createProjectViaUi(page, slug, "Ops");
    await addTaskViaUi(page, slug, "Ops", "Ledger", ["Finance"]);
    await setTaskVisibility(page, slug, "By group", "Every active task already has a group.");

    const fin = await addTeammate(page, browser, baseURL, slug, "Fin Invitee", "Member", [
      "Finance",
    ]);
    await openTracker(fin.page, slug);
    const options = await pickerOptions(fin.page, projectButton(fin.page));
    expect(options).toEqual(expect.arrayContaining(["Ops", "Ops › Ledger"]));
    await fin.context.close();
  });
});
