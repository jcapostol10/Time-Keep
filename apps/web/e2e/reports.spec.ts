import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures";
import { createClientViaUi, createProjectViaUi } from "./helpers/catalog";
import { waitForEmail } from "./helpers/mail";
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

  test("Back undoes a filter change", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await createProject(page, "Web");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("1:30:00");

    await toggleFilter(page, "Projects", "Web");
    await expect(reportTotal(page)).toHaveText("1:00:00");
    await page.goBack();
    await expect(page).toHaveURL(/\/reports\/summary$/);
    await expect(reportTotal(page)).toHaveText("1:30:00");
    await expect(page.getByRole("button", { name: "Projects: All" })).toBeVisible();
  });

  test("at 375px the filters fold into a sheet and the page does not scroll sideways", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await trackerPage();
    await createProject(page, "Web");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("1:30:00");
    await expect(page.getByRole("button", { name: /^Projects:/ })).toBeHidden();
    await page.getByRole("button", { name: "Filters" }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    await toggleFilter(page, "Projects", "Web");
    await expect(page).toHaveURL(/projectIds=/);
    // The picker closed on the first Escape; the next one closes the sheet.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(reportTotal(page)).toHaveText("1:00:00");
    await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
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
    // Another member's real id (from their own session; profile.spec may be renaming them),
    // and proof, read as the owner, that their total differs.
    const idOf = async (who: "member1" | "member2") => {
      await demoUser(who);
      const res = await page.request.get("/api/auth/get-session");
      return ((await res.json()) as { user: { id: string } }).user.id;
    };
    const member1 = await idOf("member1");
    const member2 = await idOf("member2");
    await demoUser("owner");
    const totalOf = async (id: string) => {
      const res = await page.request.get(
        `/api/w/demo/reports/summary?preset=this-year&userIds=${id}`,
      );
      return ((await res.json()) as { totals: { durationSeconds: number } }).totals.durationSeconds;
    };
    expect(await totalOf(member2)).not.toBe(await totalOf(member1));

    await demoUser("member1");
    await openReport(page, "demo", "summary", "preset=this-year");
    const own = await reportTotal(page).textContent();
    await openReport(page, "demo", "summary", `preset=this-year&userIds=${member2}`);
    await expect(reportTotal(page)).toHaveText(own ?? "");
    await expect(page.getByRole("button", { name: /^Users:/ })).toHaveCount(0);
  });

  test("the Groups filter narrows the summary to the group's members", async ({
    page,
    demoUser,
  }) => {
    const idOf = async (who: "member1" | "member2") => {
      await demoUser(who);
      const res = await page.request.get("/api/auth/get-session");
      return ((await res.json()) as { user: { id: string } }).user.id;
    };
    // The seeded Design group is member1 and member2.
    const design = [await idOf("member1"), await idOf("member2")];
    await demoUser("owner");
    const res = await page.request.get(
      `/api/w/demo/reports/summary?preset=this-year&${design.map((id) => `userIds=${id}`).join("&")}`,
    );
    const seconds = ((await res.json()) as { totals: { durationSeconds: number } }).totals
      .durationSeconds;

    await openReport(page, "demo", "summary", "preset=this-year");
    const everyone = await reportTotal(page).textContent();
    await toggleFilter(page, "Groups", "Design");
    await expect(page).toHaveURL(/groupIds=/);
    await expect(reportTotal(page)).not.toHaveText(everyone ?? "");
    const shown = await page.request.get(
      `/api/w/demo/reports/summary?${new URL(page.url()).searchParams.toString()}`,
    );
    expect(
      ((await shown.json()) as { totals: { durationSeconds: number } }).totals.durationSeconds,
    ).toBe(seconds);
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

  test("a summary row opens the detailed report filtered to it", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await createProject(page, "Web");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "summary");
    await groupRow(page, "Web").getByRole("link", { name: "Web" }).click();
    await expect(page).toHaveURL(/\/reports\/detailed\?.*projectIds=/);
    await expect(reportTotal(page)).toHaveText("1:00:00");
    await expect(page.getByRole("row", { name: "Entry Site work" })).toBeVisible();
    await expect(page.getByRole("row", { name: "Entry Email" })).toHaveCount(0);
  });

  test("a weekly cell opens the detailed report for that project and day", async ({
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
    await grid.getByRole("row", { name: /^Web / }).getByRole("link", { name: "1:00:00" }).click();
    await expect(page).toHaveURL(/\/reports\/detailed\?/);
    await expect(reportTotal(page)).toHaveText("1:00:00");
    await expect(page.getByRole("row", { name: "Entry Site work" })).toBeVisible();
  });

  test("select own entries in the detailed report and delete them, with undo", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });
    await openReport(page, freshUser.slug, "detailed");
    await expect(reportTotal(page)).toHaveText("1:30:00");
    await page.getByRole("checkbox", { name: "Select Site work" }).check();
    const bar = page.getByRole("toolbar", { name: "Selected entries" });
    await expect(bar).toContainText("1 selected");
    await bar.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("row", { name: "Entry Site work" })).toHaveCount(0);
    await expect(reportTotal(page)).toHaveText("0:30:00");
    await expect(bar).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("row", { name: "Entry Site work" })).toBeVisible();
    await expect(reportTotal(page)).toHaveText("1:30:00");

    await page.getByRole("checkbox", { name: "Select all your entries" }).check();
    await expect(bar).toContainText("2 selected");
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

  test("the weekly export lists people when the grid does", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "weekly");
    await page.getByRole("combobox", { name: "Rows" }).click();
    await page.getByRole("option", { name: "People" }).click();
    await expect(page).toHaveURL(/weeklyBy=user/);
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "CSV" }).click(),
    ]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toMatch(/\r\nFresh [^,]*,/);
    expect(text).not.toContain("No project,");
  });

  test("export the summary as CSV", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "summary");
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^timekeep-summary-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain("Project,Duration,Billable,Entries");
    expect(text).toContain("No project,1:00:00,0:00:00,1");
  });

  test("a large export becomes a job with a download link and an email", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    // e2e runs with EXPORT_JOB_THRESHOLD=5, so six entries make a job.
    await trackerPage();
    for (let i = 0; i < 6; i++) {
      await addManualEntry(page, {
        description: `Row ${i}`,
        start: `0${i}:05`,
        duration: "0.25",
      });
    }
    await openReport(page, freshUser.slug, "detailed");
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "CSV" }).click();
    await expect(page.getByText("This export is large")).toBeVisible();
    await page.getByRole("link", { name: "Exports", exact: true }).click();
    const job = page.getByRole("row", { name: /Detailed · CSV/ });
    await expect(job).toContainText("Ready", { timeout: 30_000 });
    await expect(job).toContainText("6 rows");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      job.getByRole("button", { name: "Download" }).click(),
    ]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain("Row 5");
    expect(text.trim().split("\r\n")).toHaveLength(7);
    const email = await waitForEmail(freshUser.email, { subject: /export is ready/i });
    expect(email.Text).toContain("6 rows");
  });

  test("export the summary as PDF", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openReport(page, freshUser.slug, "summary");
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("menuitem", { name: "PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
