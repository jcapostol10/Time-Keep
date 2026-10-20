import { expect, test } from "./fixtures";
import {
  clientRow,
  createClientViaUi,
  createProjectViaUi,
  projectRow,
  rowAction,
} from "./helpers/catalog";
import { addManualEntry, entry, pickProject, projectButton, timer, today } from "./helpers/tracker";

/** The Projects page: list, filters, favourites, bulk archive and delete. */
test.describe("projects", () => {
  test("create a project from the projects page", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Acme Corp");
    await page.goto(`/w/${freshUser.slug}/projects`);
    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByLabel("Name").fill("Website");
    await dialog.getByRole("combobox", { name: "Client" }).click();
    await page.getByRole("option", { name: "Acme Corp" }).click();
    await dialog.getByRole("radio", { name: "#2563eb" }).click();
    await expect(dialog.getByRole("switch", { name: "Billable by default" })).toBeChecked();
    await dialog.getByRole("radio", { name: "Private" }).click();
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog).toBeHidden();

    const row = projectRow(page, "Website");
    await expect(row).toContainText("Acme Corp");
    await expect(row).toContainText("Private");

    // The client is now in use, so it cannot be deleted.
    await page.goto(`/w/${freshUser.slug}/clients`);
    await expect(
      clientRow(page, "Acme Corp").getByRole("cell", { name: "1", exact: true }),
    ).toBeVisible();
    await clientRow(page, "Acme Corp").getByRole("button", { name: "More actions" }).click();
    const del = page.getByRole("menuitem", { name: "Delete" });
    await expect(del).toHaveAttribute("aria-disabled", "true");
    await expect(del).toHaveAttribute("title", "Move or delete its projects first");
  });

  test("filter, search and sort the projects list", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Globex");
    await createProjectViaUi(page, freshUser.slug, "Alpha", { client: "Globex" });
    await createProjectViaUi(page, freshUser.slug, "Beta", { billable: false });
    await createProjectViaUi(page, freshUser.slug, "Gamma", { visibility: "Private" });
    await rowAction(page, projectRow(page, "Beta"), "Archive");
    await expect(projectRow(page, "Beta")).toHaveCount(0);

    const select = async (label: string, option: string) => {
      await page.getByRole("combobox", { name: label }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    // The third cell is the name (after the checkbox and the star); a badge may follow on a new line.
    const names = () => page.getByRole("table").locator("tbody tr td:nth-child(3)").allInnerTexts();

    await select("Client", "Globex");
    await expect(projectRow(page, "Alpha")).toBeVisible();
    await expect(projectRow(page, "Gamma")).toHaveCount(0);
    await select("Client", "All clients");

    await select("Status", "Archived");
    await expect(projectRow(page, "Beta")).toContainText("Archived");
    await expect(projectRow(page, "Alpha")).toHaveCount(0);
    await select("Status", "All");
    await select("Billing", "Non-billable");
    await expect(projectRow(page, "Beta")).toBeVisible();
    await expect(projectRow(page, "Alpha")).toHaveCount(0);
    await select("Billing", "All billing");

    await select("Access", "Private");
    await expect(projectRow(page, "Gamma")).toBeVisible();
    await expect(projectRow(page, "Alpha")).toHaveCount(0);
    await select("Access", "All access");

    await page.getByRole("searchbox", { name: "Search projects" }).fill("glob");
    await expect(projectRow(page, "Alpha")).toBeVisible();
    await expect(projectRow(page, "Gamma")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search projects" }).fill("");

    await select("Sort", "Name Z–A");
    await expect
      .poll(async () => (await names()).map((t) => t.split("\n")[0]))
      .toEqual(["Gamma", "Beta", "Alpha"]);
  });

  test("favourite a project", async ({ page, freshUser }) => {
    await createProjectViaUi(page, freshUser.slug, "Alpha");
    await createProjectViaUi(page, freshUser.slug, "Zeta");
    const star = page.getByRole("button", { name: "Favourite Zeta" });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    const starred = page.getByRole("button", { name: "Unfavourite Zeta" });
    await expect(starred).toHaveAttribute("aria-pressed", "true");
    await expect(starred).toBeEnabled(); // the save has landed

    await page.reload();
    await expect(page.getByRole("button", { name: "Unfavourite Zeta" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Favourite Alpha" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("bulk archive; archived projects keep their time but take no new time", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Old");
    await trackerPage();
    await pickProject(page, "Old");
    await addManualEntry(page, { description: "Legacy work", start: "00:05", duration: "1" });

    await page.goto(`/w/${freshUser.slug}/projects`);
    await page.getByRole("checkbox", { name: "Select Old" }).check();
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(projectRow(page, "Old")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Archived" }).click();
    await expect(projectRow(page, "Old")).toContainText("Archived");

    await trackerPage();
    await expect(
      entry(page, "Legacy work").getByRole("button", { name: /^Project:/ }),
    ).toHaveAccessibleName("Project: Old");
    await projectButton(page).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill("Old");
    await expect(page.getByRole("option", { name: "Old", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await today(page).getByRole("button", { name: 'Continue "Legacy work"' }).click();
    await expect(page.getByText("This project is archived.")).toBeVisible();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();
  });

  test("project names are unique per client", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Acme Corp");
    await createClientViaUi(page, freshUser.slug, "Globex");
    await createProjectViaUi(page, freshUser.slug, "Site", { client: "Acme Corp" });
    await createProjectViaUi(page, freshUser.slug, "Site", { client: "Globex" });
    await expect(projectRow(page, "Site")).toHaveCount(2);

    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByLabel("Name").fill("Site");
    await dialog.getByRole("combobox", { name: "Client" }).click();
    await page.getByRole("option", { name: "Acme Corp" }).click();
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(
      dialog.getByText("A project with this name already exists for this client."),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("delete a project and move its entries", async ({ page, freshUser, trackerPage }) => {
    await createProjectViaUi(page, freshUser.slug, "Web");
    await createProjectViaUi(page, freshUser.slug, "App");
    await trackerPage();
    await pickProject(page, "Web");
    await addManualEntry(page, { description: "Moved work", start: "00:05", duration: "1" });

    await page.goto(`/w/${freshUser.slug}/projects`);
    await rowAction(page, projectRow(page, "Web"), "Delete");
    const dialog = page.getByRole("alertdialog", { name: "Delete project?" });
    await expect(dialog).toContainText("1 entry");
    await dialog.getByRole("radio", { name: "Move its entries to" }).click();
    await dialog.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: "App", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete project" }).click();
    await expect(dialog).toBeHidden();
    await expect(projectRow(page, "Web")).toHaveCount(0);

    await trackerPage();
    await expect(
      entry(page, "Moved work").getByRole("button", { name: /^Project:/ }),
    ).toHaveAccessibleName("Project: App");
  });

  test("delete a project and its entries", async ({ page, freshUser, trackerPage }) => {
    await createProjectViaUi(page, freshUser.slug, "Temp");
    await trackerPage();
    await pickProject(page, "Temp");
    await addManualEntry(page, { description: "Gone work", start: "00:05", duration: "1" });

    await page.goto(`/w/${freshUser.slug}/projects`);
    await rowAction(page, projectRow(page, "Temp"), "Delete");
    const dialog = page.getByRole("alertdialog", { name: "Delete project?" });
    await dialog.getByRole("radio", { name: "Delete its entries" }).click();
    await dialog.getByRole("button", { name: "Delete project" }).click();
    await expect(dialog).toBeHidden();

    await trackerPage();
    await expect(entry(page, "Gone work")).toHaveCount(0);
  });

  test("a member sees Your time; admins see Tracked", async ({ page, demoUser }) => {
    await demoUser("member1");
    await page.goto("/w/demo/projects");
    await expect(page.getByRole("columnheader", { name: "Your time" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Tracked" })).toHaveCount(0);

    await demoUser("owner");
    await page.goto("/w/demo/projects");
    await expect(page.getByRole("columnheader", { name: "Tracked" })).toBeVisible();
  });
});
