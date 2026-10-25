import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { addManualEntry, createProject, timer } from "./helpers/tracker";

/** The dashboard: a person's own week, and who on the team is tracking now. */

test.describe("dashboard", () => {
  test("the dashboard shows this week's total, top project and most tracked", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await createProject(page, "Web");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await page.goto(`/w/${freshUser.slug}/dashboard`);
    await waitForApp(page);
    await expect(page.getByTestId("dashboard-total")).toHaveText("1:30:00");
    await expect(page.getByTestId("dashboard-top-project")).toContainText("Web");
    const most = page.getByRole("list", { name: "Most tracked" });
    await expect(most.getByRole("listitem").first()).toContainText("Site work");
    await expect(most.getByRole("listitem").nth(1)).toContainText("Email");
  });

  test("the Team tab shows who is tracking now within a poll", async ({
    page,
    browser,
    freshUser,
  }) => {
    await page.clock.install();
    await page.goto(`/w/${freshUser.slug}/dashboard?tab=team`);
    await waitForApp(page);
    const me = page.getByRole("row", { name: /Fresh Tester/ });
    await expect(me).toBeVisible();
    await expect(me.getByText("Tracking now")).toHaveCount(0);

    // A timer started on another machine: a separate browser context with the same session,
    // so no cross-tab broadcast reaches this page; only the poll can.
    const otherContext = await browser.newContext({
      storageState: await page.context().storageState(),
      extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
    });
    const other = await otherContext.newPage();
    await other.goto(`/w/${freshUser.slug}/tracker`);
    await waitForApp(other);
    await timer(other).getByRole("combobox", { name: "Description" }).fill("Live work");
    await timer(other).getByRole("button", { name: "Start" }).click();
    await expect(timer(other).getByRole("button", { name: "Stop" })).toBeVisible();

    await page.clock.runFor(31_000);
    await expect(me.getByText("Tracking now")).toBeVisible();
    await expect(me).toContainText("Live work");

    await timer(other).getByRole("button", { name: "Stop" }).click();
    await expect(timer(other).getByRole("button", { name: "Start" })).toBeVisible();
    await otherContext.close();
  });

  test("a member has no Team tab", async ({ page, demoUser }) => {
    await demoUser("member1");
    await page.goto("/w/demo/dashboard");
    await waitForApp(page);
    await expect(page.getByTestId("dashboard-total")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Team" })).toHaveCount(0);
  });
});
