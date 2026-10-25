import { expect, test } from "./fixtures";
import { createClientViaUi, createProjectViaUi } from "./helpers/catalog";
import {
  detailedRow,
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
  waitForSaves,
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

  test("the detailed report lists entries and loads more", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "First", start: "00:05", duration: "0.5" });
    await addManualEntry(page, { description: "Second", start: "01:05", duration: "0.5" });
    await addManualEntry(page, { description: "Third", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "detailed", "limit=2");
    await expect(reportTotal(page)).toHaveText("1:30:00");
    await expect(detailedRow(page, "Third")).toBeVisible();
    await expect(detailedRow(page, "Second")).toBeVisible();
    await expect(detailedRow(page, "First")).toHaveCount(0);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(detailedRow(page, "First")).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  });

  test("edit the description and duration of an own entry inline", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Draft", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "detailed");
    const row = detailedRow(page, "Draft");
    await row.getByRole("textbox", { name: "Description" }).fill("Final");
    await row.getByRole("textbox", { name: "Description" }).press("Enter");
    const edited = detailedRow(page, "Final");
    await edited.getByRole("textbox", { name: "Duration" }).fill("2");
    await edited.getByRole("textbox", { name: "Duration" }).press("Enter");
    await expect(reportTotal(page)).toHaveText("2:00:00");
    await waitForSaves(page);
    await page.reload();
    await expect(detailedRow(page, "Final").getByRole("textbox", { name: "Duration" })).toHaveValue(
      "2:00:00",
    );
  });

  test("another person's entry is read-only", async ({ page, demoUser }) => {
    await demoUser("manager");
    await openReport(page, "demo", "detailed", "preset=last-week");
    const theirs = page.getByRole("row").filter({ hasText: "Mia Member" }).first();
    await expect(theirs).toBeVisible();
    await expect(theirs.getByRole("textbox")).toHaveCount(0);
    const own = page.getByRole("row").filter({ hasText: "Maya Manager" }).first();
    await expect(own.getByRole("textbox", { name: "Description" })).toBeVisible();
  });

  test("the column chooser hides a column and remembers it after reload", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "detailed");
    await expect(page.getByRole("columnheader", { name: "Client" })).toBeVisible();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Client" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);
    await page.reload();
    await expect(detailedRow(page, "Site work")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);
  });

  test("sort the detailed report by duration", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Short", start: "00:05", duration: "0.25" });
    await addManualEntry(page, { description: "Long", start: "00:30", duration: "2" });
    await addManualEntry(page, { description: "Middle", start: "03:00", duration: "1" });
    await openReport(page, freshUser.slug, "detailed");
    const names = () =>
      page
        .getByRole("row", { name: /^Entry / })
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-label")));
    await expect.poll(names).toEqual(["Entry Middle", "Entry Long", "Entry Short"]);
    await page.getByRole("button", { name: "Sort by duration" }).click();
    await expect.poll(names).toEqual(["Entry Long", "Entry Middle", "Entry Short"]);
  });

  test("the weekly grid by project shows day and row totals that match the summary", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await createProject(page, "Web");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "weekly");
    const grid = page.getByRole("table", { name: "Weekly report" });
    await expect(grid.getByRole("row", { name: /^Web / })).toContainText("1:00:00");
    await expect(grid.getByRole("row", { name: /^No project / })).toContainText("0:30:00");
    await expect(page.getByTestId("weekly-today-total")).toHaveText("1:30:00");
    await expect(reportTotal(page)).toHaveText("1:30:00");
    await page.getByRole("link", { name: "Summary", exact: true }).click();
    await expect(reportTotal(page)).toHaveText("1:30:00");
  });

  test("the weekly grid can list people instead of projects", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "weekly");
    await page.getByRole("combobox", { name: "Rows" }).click();
    await page.getByRole("option", { name: "People" }).click();
    const grid = page.getByRole("table", { name: "Weekly report" });
    await expect(grid.getByRole("row", { name: /^Fresh / })).toContainText("1:00:00");
  });
});
