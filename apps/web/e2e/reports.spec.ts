import { expect, test } from "./fixtures";
import { createClientViaUi, createProjectViaUi } from "./helpers/catalog";
import {
  groupRow,
  openReport,
  reportTotal,
  setGroupBy,
  setPreset,
  toggleFilter,
  trackerWeekTotal,
} from "./helpers/reports";
import { dateKey, daysAgo } from "./helpers/timesheet";
import {
  addManualEntry,
  addManualEntryOn,
  createProject,
  createTag,
  pickProject,
} from "./helpers/tracker";

/** The Summary report: totals, chart, grouped table, filters and presets in the URL. */

test.describe("reports", () => {
  test("the summary shows the week's total, a chart and a grouped table", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("1:30:00");
    await expect(page.getByTestId("summary-chart").locator("svg").first()).toBeVisible();
    await expect(groupRow(page, "No project")).toContainText("1:30:00");
  });

  test("filter by project and by tag", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await createProject(page, "Web");
    await createTag(page, "urgent");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    // The bar's draft clears after an add, so this one has no project and no tag.
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("1:30:00");

    await toggleFilter(page, "Projects", "Web");
    await expect(page).toHaveURL(/projectIds=/);
    await expect(reportTotal(page)).toHaveText("1:00:00");
    await toggleFilter(page, "Projects", "Web");
    await toggleFilter(page, "Projects", "Without project");
    await expect(reportTotal(page)).toHaveText("0:30:00");
    await toggleFilter(page, "Projects", "Without project");
    await expect(reportTotal(page)).toHaveText("1:30:00");

    await toggleFilter(page, "Tags", "urgent");
    await expect(page).toHaveURL(/tagIds=/);
    await expect(reportTotal(page)).toHaveText("1:00:00");
  });

  test("group by client then project shows nested totals", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createClientViaUi(page, freshUser.slug, "Acme");
    await createProjectViaUi(page, freshUser.slug, "Web", { client: "Acme" });
    await trackerPage();
    await pickProject(page, "Web");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "summary");
    await setGroupBy(page, ["Client", "Project"]);
    await expect(page).toHaveURL(/groupBy=client&groupBy=project/);
    await expect(groupRow(page, "Acme")).toContainText("1:00:00");
    await expect(groupRow(page, "Web")).toContainText("1:00:00");
    await expect(groupRow(page, "No client")).toContainText("0:30:00");
    await expect(groupRow(page, "No project")).toContainText("0:30:00");
  });

  test("presets and a custom range change the URL and the totals", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    const tz = freshUser.timezone;
    await trackerPage();
    await addManualEntry(page, { description: "Today work", start: "00:05", duration: "1" });
    // The same weekday last week is always in last week.
    await addManualEntryOn(page, {
      description: "Older",
      date: dateKey(daysAgo(7), tz),
      start: "00:05",
      duration: "2",
    });
    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("1:00:00");

    await setPreset(page, "Last week");
    await expect(page).toHaveURL(/preset=last-week/);
    await expect(reportTotal(page)).toHaveText("2:00:00");

    await setPreset(page, "Custom…");
    await page.getByLabel("From", { exact: true }).fill(dateKey(daysAgo(8), tz));
    await page.getByLabel("To", { exact: true }).fill(dateKey(new Date(), tz));
    await expect(page).toHaveURL(/preset=custom/);
    await expect(reportTotal(page)).toHaveText("3:00:00");
  });

  test("a member cannot widen the Users filter by URL", async ({ page, demoUser }) => {
    await demoUser("member1");
    await openReport(page, "demo", "summary", "preset=this-month");
    const own = await reportTotal(page).textContent();
    await openReport(page, "demo", "summary", "preset=this-month&userIds=someone-else");
    await expect(reportTotal(page)).toHaveText(own ?? "");
    await expect(page.getByRole("button", { name: /^Users:/ })).toHaveCount(0);
  });

  test("the summary agrees with the tracker's week total", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.75" });
    const weekTotal = await trackerWeekTotal(page);
    expect(weekTotal).toBe("1:45:00");
    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText(weekTotal);
  });
});
