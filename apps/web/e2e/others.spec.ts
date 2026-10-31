import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { openSettings, saveSettings } from "./helpers/settings";
import { addTeammate, memberAction, openTeam } from "./helpers/team";
import { addManualEntry, entryOrGroup, timer } from "./helpers/tracker";

/**
 * Add time for others (Phase 4b, decision 8): admins and managers pick a
 * person and work on that person's entries; the timer stays their own.
 */

async function openTracker(page: Page, slug: string, query = "") {
  await page.goto(`/w/${slug}/tracker${query}`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
}

/** Picks a person in the page's Person select and waits for the URL to follow. */
async function pickPerson(page: Page, name: string, self = false) {
  await page.getByRole("combobox", { name: "Person", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  if (self) await expect(page).not.toHaveURL(/user=/);
  else await expect(page).toHaveURL(/user=/);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
}

test.describe("add time for others", () => {
  test("an admin adds time for a member and the member sees it in their tracker", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await openTracker(page, freshUser.slug);
    await pickPerson(page, "Mia Member");
    await addManualEntry(page, { description: "Done for Mia", start: "00:05", duration: "1" });
    // Favourites are the viewer's own: another person's row offers no "Pin as favourite".
    await entryOrGroup(page, "Done for Mia").getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Pin as favourite" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await openTracker(mia.page, freshUser.slug);
    await expect(entryOrGroup(mia.page, "Done for Mia")).toBeVisible();

    // The admin's own list does not have it.
    await pickPerson(page, "Fresh Tester", true);
    await expect(entryOrGroup(page, "Done for Mia")).toHaveCount(0);
    await mia.context.close();
  });

  test("a manager's person picker lists only their people", async ({ page, demoUser }) => {
    // Max's id from his own session, not by name: profile.spec renames him for a moment.
    await demoUser("member2");
    const session = await page.request.get("/api/auth/get-session");
    const { user: max } = (await session.json()) as { user: { id: string } };
    if (!max?.id) throw new Error("no session for member2");

    await demoUser("manager");
    await page.goto("/w/demo/tracker");
    await waitForApp(page);
    await page.getByRole("combobox", { name: "Person", exact: true }).click();
    await expect(page.getByRole("option")).toHaveText(["Maya Manager", "Mia Member"]);
    await page.keyboard.press("Escape");

    // Someone outside the scope is not found, as if they did not exist.
    await page.goto(`/w/demo/tracker?user=${max.id}`);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });

  test("the timer bar stays the viewer's own", async ({ page, freshUser, browser, baseURL }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await openTracker(page, freshUser.slug);
    await pickPerson(page, "Mia Member");

    await timer(page).getByRole("combobox", { name: "Description" }).fill("Own work");
    await timer(page).getByRole("button", { name: "Start" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await page.waitForTimeout(1_100);
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();
    // Mia's list stays Mia's.
    await expect(entryOrGroup(page, "Own work")).toHaveCount(0);

    await pickPerson(page, "Fresh Tester", true);
    await expect(entryOrGroup(page, "Own work")).toBeVisible();
    await mia.context.close();
  });

  test("a manager under force timer adds time for a managed person from their tracker", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const max = await addTeammate(page, browser, baseURL, freshUser.slug, "Max Manager", "Manager");
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await mia.context.close();
    await openTeam(page, freshUser.slug);
    await memberAction(page, "Max Manager", "People and projects");
    const scope = page.getByRole("dialog", { name: "People and projects Max Manager manages" });
    await scope.getByRole("checkbox", { name: "Mia Member" }).check();
    await scope.getByRole("button", { name: "Save" }).click();
    await expect(scope).toBeHidden();
    await openSettings(page, freshUser.slug);
    await page.getByRole("switch", { name: "Force timer" }).click();
    await saveSettings(page);

    // Their own time is the timer's; a managed person's may still be typed (decision 7).
    await openTracker(max.page, freshUser.slug);
    await expect(timer(max.page).getByRole("button", { name: "Manual mode" })).toHaveCount(0);
    await pickPerson(max.page, "Mia Member");
    await addManualEntry(max.page, { description: "For Mia", start: "00:05", duration: "1" });
    await expect(entryOrGroup(max.page, "For Mia")).toBeVisible();
    await max.context.close();
  });
});
