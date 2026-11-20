import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { timer } from "./helpers/tracker";

/** The app frame: the sidebar, the top bar and what they say about a running timer. */
test.describe("shell", () => {
  test("a running timer shows a chip in the top bar that links to the tracker", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    const banner = page.getByRole("banner");
    const chip = banner.getByRole("link", { name: /Timer running/ });
    await expect(chip).toHaveCount(0);

    await timer(page).getByRole("combobox", { name: "Description" }).fill("Chip check");
    await timer(page).getByRole("button", { name: "Start" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/0:00:\d\d/);
    await expect(chip).toContainText("Chip check");

    // It follows the person to any page, and takes them back to the tracker.
    await page.goto(`/w/${freshUser.slug}/timesheet`);
    await waitForApp(page);
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/w/${freshUser.slug}/tracker$`));

    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(chip).toHaveCount(0);
  });

  test("the sidebar marks the page the person is on", async ({ page, freshUser }) => {
    await page.goto(`/w/${freshUser.slug}/timesheet`);
    await waitForApp(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Timesheet" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Time Tracker" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
