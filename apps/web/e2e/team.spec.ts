import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { uniqueEmail, waitForApp } from "./helpers/app";
import { createProjectViaUi } from "./helpers/catalog";
import { groupRow, openReport, setGroupBy } from "./helpers/reports";
import { addTeammate, inviteViaUi, memberAction, memberRow, openTeam } from "./helpers/team";
import { addManualEntry, projectButton } from "./helpers/tracker";

const NOT_FOUND = "We couldn't find that page";

/**
 * Delays the Team page's filter navigations, as on a distant server: a second filter
 * change made before the first one's page arrives must not undo the first.
 */
async function slowFilterNavigations(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const isFilterNavigation =
      request.headers()["rsc"] === "1" && new URL(request.url()).pathname.endsWith("/team");
    if (isFilterNavigation) await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
}

test.describe("team", { tag: "@nightly" }, () => {
  test("cancel a pending invitation", async ({ page, freshUser }) => {
    const pending = uniqueEmail("cancel");
    const dialog = await inviteViaUi(page, freshUser.slug, [pending], "Member");
    await dialog.getByRole("button", { name: "Done" }).click();
    await openTeam(page, freshUser.slug, "status=INVITED");
    await expect(memberRow(page, pending)).toBeVisible();
    await memberAction(page, pending, "Cancel invitation");
    await expect(page.getByText("Invitation cancelled")).toBeVisible();
    await expect(memberRow(page, pending)).toHaveCount(0);
    await page.reload();
    await waitForApp(page);
    await expect(memberRow(page, pending)).toHaveCount(0);
  });

  test("bulk invite reports each address", async ({ page, freshUser }) => {
    const newcomer = uniqueEmail("newcomer");
    const dialog = await inviteViaUi(
      page,
      freshUser.slug,
      [newcomer, "not-an-email", freshUser.email],
      "Member",
    );
    const results = dialog.getByRole("list", { name: "Invitation results" });
    await expect(results.getByRole("listitem").filter({ hasText: newcomer })).toContainText(
      "Invited",
    );
    await expect(results.getByRole("listitem").filter({ hasText: "not-an-email" })).toContainText(
      "Not a valid address",
    );
    await expect(results.getByRole("listitem").filter({ hasText: freshUser.email })).toContainText(
      "Already a member",
    );
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(memberRow(page, newcomer)).toContainText("Invited");
  });

  test("user import previews and invites", async ({ page, freshUser }) => {
    await openTeam(page, freshUser.slug);
    await page.getByRole("button", { name: "Import from CSV" }).click();
    const dialog = page.getByRole("dialog", { name: "Import people" });
    const ana = uniqueEmail("ana");
    const csv = [
      "email,role,groups",
      `${ana},admin,Design`,
      "not-an-email,member,",
      `${freshUser.email},member,`,
    ].join("\n");
    await dialog.getByLabel("CSV file").setInputFiles({
      name: "people.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    const preview = dialog.getByRole("table", { name: "Import preview" });
    await expect(preview.getByRole("row").filter({ hasText: ana })).toContainText("Ready");
    await expect(preview.getByRole("row").filter({ hasText: "not-an-email" })).toContainText(
      "Not a valid address",
    );
    await expect(preview.getByRole("row").filter({ hasText: freshUser.email })).toContainText(
      "Already a member",
    );
    await expect(preview.getByRole("row").filter({ hasText: ana })).toContainText("Design (new)");
    await dialog.getByRole("button", { name: "Invite 1 person" }).click();
    await expect(dialog).toBeHidden();
    await expect(memberRow(page, ana)).toContainText("Invited");
    await expect(memberRow(page, ana)).toContainText("Admin");
    await page.getByRole("tab", { name: "Groups" }).click();
    await expect(page.getByRole("row", { name: /Design/ })).toBeVisible();
  });

  test("a member's role, deactivation and removal", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");

    // A member sees the team read-only.
    await openTeam(mia.page, freshUser.slug);
    await expect(memberRow(mia.page, "Mia Member")).toBeVisible();
    await expect(mia.page.getByRole("button", { name: "Invite members" })).toHaveCount(0);
    await expect(mia.page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);

    // Change the role.
    await openTeam(page, freshUser.slug);
    await memberAction(page, "Mia Member", "Change role");
    const role = page.getByRole("dialog", { name: "Change role" });
    await role.getByRole("radio", { name: "Manager" }).click();
    await role.getByRole("button", { name: "Save role" }).click();
    await expect(memberRow(page, "Mia Member")).toContainText("Manager");

    // Deactivate: the workspace closes to her; reactivate: it opens again.
    await memberAction(page, "Mia Member", "Deactivate");
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Deactivated" }).click();
    await expect(memberRow(page, "Mia Member")).toContainText("Deactivated");
    await mia.page.goto(`/w/${freshUser.slug}/tracker`);
    await expect(mia.page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
    await memberAction(page, "Mia Member", "Reactivate");
    // Wait for the save: while the menu is open the table is hidden from role
    // queries, so the row's absence proves nothing.
    await expect(page.getByText("Mia Member is active again")).toBeVisible();
    await mia.page.goto(`/w/${freshUser.slug}/tracker`);
    await waitForApp(mia.page);
    await expect(mia.page.getByRole("heading", { name: "Time Tracker" })).toBeVisible();

    // Her time stays in the reports after she is removed, as a former member.
    await addManualEntry(mia.page, { description: "Mia's work", start: "00:05", duration: "1" });
    await openTeam(page, freshUser.slug);
    await memberAction(page, "Mia Member", "Remove");
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Mia Member removed")).toBeVisible();
    await expect(memberRow(page, "Mia Member")).toHaveCount(0);
    await openReport(page, freshUser.slug, "summary");
    await setGroupBy(page, ["Person"]);
    await expect(groupRow(page, "Mia Member")).toContainText("1:00:00");
    await page.getByRole("button", { name: /^Users:/ }).click();
    await expect(page.getByRole("option", { name: "Mia Member (former member)" })).toBeVisible();
    await mia.context.close();
  });

  test("transfer ownership to an admin", async ({ page, freshUser, browser, baseURL }) => {
    const ada = await addTeammate(page, browser, baseURL, freshUser.slug, "Ada Admin", "Admin");
    await openTeam(page, freshUser.slug);
    await memberAction(page, "Ada Admin", "Transfer ownership");
    const dialog = page.getByRole("dialog", { name: "Transfer ownership" });
    await dialog.getByLabel("Workspace name").fill("not the name");
    await dialog.getByRole("button", { name: "Transfer ownership" }).click();
    await expect(dialog).toContainText(/exactly/);
    const name = await dialog.getByTestId("workspace-name").textContent();
    await dialog.getByLabel("Workspace name").fill(name ?? "");
    await dialog.getByRole("button", { name: "Transfer ownership" }).click();
    await expect(dialog).toBeHidden();
    await expect(memberRow(page, "Ada Admin")).toContainText("Owner");
    await expect(memberRow(page, "Fresh Tester")).toContainText("Admin");
    await ada.context.close();
  });

  test("a manager's scope limits their Summary", async ({ page, freshUser, browser, baseURL }) => {
    const max = await addTeammate(page, browser, baseURL, freshUser.slug, "Max Manager", "Manager");
    const bob = await addTeammate(page, browser, baseURL, freshUser.slug, "Bob Member", "Member");
    const cara = await addTeammate(page, browser, baseURL, freshUser.slug, "Cara Member", "Member");
    await addManualEntry(bob.page, { description: "Bob's work", start: "00:05", duration: "1" });
    await addManualEntry(cara.page, { description: "Cara's work", start: "00:05", duration: "2" });

    await openTeam(page, freshUser.slug);
    await memberAction(page, "Max Manager", "People and projects");
    const scope = page.getByRole("dialog", { name: "People and projects Max Manager manages" });
    await scope.getByRole("checkbox", { name: "Bob Member" }).check();
    await scope.getByRole("button", { name: "Save" }).click();
    await expect(scope).toBeHidden();

    await openReport(max.page, freshUser.slug, "summary");
    await setGroupBy(max.page, ["Person"]);
    await expect(groupRow(max.page, "Bob Member")).toContainText("1:00:00");
    await expect(groupRow(max.page, "Cara Member")).toHaveCount(0);
    for (const t of [max, bob, cara]) await t.context.close();
  });

  test("groups: filter members, and a group on a private project lets its member track on it", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const gus = await addTeammate(page, browser, baseURL, freshUser.slug, "Gus Member", "Member");
    await createProjectViaUi(page, freshUser.slug, "Secret", { visibility: "Private" });

    await openTeam(page, freshUser.slug);
    await page.getByRole("tab", { name: "Groups" }).click();
    await page.getByRole("button", { name: "New group" }).click();
    const create = page.getByRole("dialog", { name: "New group" });
    await create.getByLabel("Name").fill("Design");
    await create.getByRole("button", { name: "Create group" }).click();
    await expect(create).toBeHidden();
    await page.getByRole("button", { name: "Actions for Design" }).click();
    await page.getByRole("menuitem", { name: "Members" }).click();
    const members = page.getByRole("dialog", { name: "Members of Design" });
    await members.getByRole("checkbox", { name: "Gus Member" }).check();
    await members.getByRole("button", { name: "Save" }).click();
    await expect(members).toBeHidden();

    // Filter the members table by group, and by status.
    await page.getByRole("tab", { name: "Members" }).click();
    const pending = uniqueEmail("pending");
    const invited = await inviteViaUi(page, freshUser.slug, [pending], "Member");
    await invited.getByRole("button", { name: "Done" }).click();
    await slowFilterNavigations(page);
    await page.getByRole("combobox", { name: "Group" }).click();
    await page.getByRole("option", { name: "Design" }).click();
    await expect(memberRow(page, "Gus Member")).toBeVisible();
    await expect(memberRow(page, "Fresh Tester")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Group" }).click();
    await page.getByRole("option", { name: "Any group" }).click();
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Invited", exact: true }).click();
    await expect(memberRow(page, pending)).toBeVisible();
    await expect(memberRow(page, "Gus Member")).toHaveCount(0);

    // Give the group access to the private project; Gus can now pick it.
    await gus.page.reload();
    await waitForApp(gus.page);
    await projectButton(gus.page).click();
    await expect(gus.page.getByRole("option", { name: "Secret", exact: true })).toHaveCount(0);
    await gus.page.keyboard.press("Escape");
    await page.goto(`/w/${freshUser.slug}/projects`);
    await page.getByRole("link", { name: "Secret" }).click();
    await page.getByRole("tab", { name: "Access" }).click();
    await page.getByRole("checkbox", { name: "Design" }).check();
    await expect(page.getByRole("checkbox", { name: "Design" })).toBeChecked();
    // The box ticks at once and is disabled while the access saves: wait for the save,
    // or Gus's reload below can come first.
    await expect(page.getByRole("checkbox", { name: "Design" })).toBeEnabled();
    await gus.page.reload();
    await waitForApp(gus.page);
    await projectButton(gus.page).click();
    await expect(gus.page.getByRole("option", { name: "Secret", exact: true })).toBeVisible();
    await gus.context.close();
  });

  test("the Team page fits a 375px screen", async ({ page, freshUser }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await openTeam(page, freshUser.slug);
    await expect(memberRow(page, "Fresh Tester")).toBeVisible();
    // Nothing reaches past the screen's edge, unless inside a horizontal scroller (a
    // clipped overflow would hide it, which the page's own scroll width does not show).
    const sticking = await page.evaluate(() => {
      const scrolls = (el: Element | null): boolean => {
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const x = getComputedStyle(e).overflowX;
          if (x === "auto" || x === "scroll") return true;
        }
        return false;
      };
      return [...document.querySelectorAll("main *")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.right > window.innerWidth + 1 && !scrolls(el.parentElement);
        })
        .map((el) => el.outerHTML.slice(0, 80));
    });
    expect(sticking).toEqual([]);
  });
});
