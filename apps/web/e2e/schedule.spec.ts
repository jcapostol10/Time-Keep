import { expect, test } from "./fixtures";
import { createProjectViaUi } from "./helpers/catalog";
import { waitForEmail } from "./helpers/mail";
import {
  addAssignmentViaUi,
  bar,
  center,
  dayCell,
  dragBetween,
  nextWeekDays,
  openSchedule,
  teamRow,
} from "./helpers/schedule";
import { addTeammate } from "./helpers/team";

/**
 * The schedule (Phase 7a): planners place people on projects day by day, see
 * who is over capacity, and publish; members see only their own published
 * plan, in My schedule and on the Calendar.
 */

test.describe("schedule", () => {
  test("assigning 10 hours a day shows the day over capacity", async ({ page, freshUser }) => {
    const { slug, timezone, name } = freshUser;
    const week = nextWeekDays(timezone);
    await createProjectViaUi(page, slug, "Website");
    await openSchedule(page, slug, "team", week.mon);
    await addAssignmentViaUi(page, {
      project: "Website",
      start: week.wed,
      end: week.wed,
      perDay: "10",
    });
    const row = teamRow(page, name);
    await expect(dayCell(row, week.wed)).toHaveAttribute("data-heat", "over");
    await expect(dayCell(row, week.wed)).toHaveAttribute("aria-label", /10:00 of 8:00 scheduled/);
    await expect(dayCell(row, week.thu)).toHaveAttribute("data-heat", "under");
  });

  test("drag to create, move and resize on the team grid", async ({ page, freshUser }) => {
    const { slug, timezone, name } = freshUser;
    const week = nextWeekDays(timezone);
    await createProjectViaUi(page, slug, "Website");
    await openSchedule(page, slug, "team", week.mon);
    const row = teamRow(page, name);
    await dragBetween(
      page,
      await center(dayCell(row, week.mon)),
      await center(dayCell(row, week.tue)),
    );
    const dialog = page.getByRole("dialog", { name: "Add assignment" });
    await expect(dialog.getByLabel("Start", { exact: true })).toHaveValue(week.mon);
    await expect(dialog.getByLabel("End", { exact: true })).toHaveValue(week.tue);
    await addAssignmentViaUi(page, {
      project: "Website",
      start: week.mon,
      end: week.tue,
      perDay: "2",
      open: false,
    });
    const b = bar(row, "Website");
    await expect(b).toBeVisible();
    // Move by one day: grab the Monday half, drop on Tuesday.
    await dragBetween(
      page,
      await center(dayCell(row, week.mon)),
      await center(dayCell(row, week.tue)),
    );
    await expect(b).toHaveAttribute("data-start", week.tue);
    await expect(b).toHaveAttribute("data-end", week.wed);
    // Resize the end to Friday.
    const handle = row.getByRole("button", { name: "Resize end" });
    await dragBetween(page, await center(handle), await center(dayCell(row, week.fri)));
    await expect(b).toHaveAttribute("data-end", week.fri);
    await b.click();
    const edit = page.getByRole("dialog", { name: "Edit assignment" });
    await expect(edit.getByLabel("Start", { exact: true })).toHaveValue(week.tue);
    await expect(edit.getByLabel("End", { exact: true })).toHaveValue(week.fri);
  });

  test("a draft is hidden from the member until Publish; then My schedule, the Calendar and an email show it", async ({
    page,
    browser,
    baseURL,
    freshUser,
  }) => {
    const { slug, timezone } = freshUser;
    const week = nextWeekDays(timezone);
    await createProjectViaUi(page, slug, "Website");
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    try {
      await openSchedule(page, slug, "team", week.mon);
      await addAssignmentViaUi(page, {
        person: "Mia Member",
        project: "Website",
        start: week.tue,
        end: week.tue,
        perDay: "4",
      });
      await expect(page.getByText("1 unpublished change")).toBeVisible();
      await openSchedule(mia.page, slug, "mine", week.mon);
      const mine = mia.page.getByRole("region", { name: "My schedule" });
      await expect(mine).toContainText("Nothing scheduled");

      await page.getByRole("button", { name: "Publish" }).click();
      await expect(page.getByText("Schedule published")).toBeVisible();
      await mia.page.reload();
      await expect(mine).toContainText("Website · 4:00");

      await mia.page.goto(`/w/${slug}/calendar?date=${week.tue}`);
      const band = mia.page.locator('[data-variant="scheduled"]').filter({ hasText: "Website" });
      await expect(band).toContainText("Scheduled: Website");

      const mail = await waitForEmail(mia.user.email, { subject: /schedule .* was updated/ });
      expect(mail.Text).toContain("Website");
    } finally {
      await mia.context.close();
    }
  });

  test("members have only My schedule and cannot edit", async ({
    page,
    browser,
    baseURL,
    freshUser,
  }) => {
    const { slug } = freshUser;
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    try {
      await openSchedule(mia.page, slug, "mine");
      const tabs = mia.page.getByRole("navigation", { name: "Schedule" });
      await expect(tabs.getByRole("link", { name: "My schedule" })).toBeVisible();
      await expect(tabs.getByRole("link", { name: "Team" })).toHaveCount(0);
      await expect(tabs.getByRole("link", { name: "Projects" })).toHaveCount(0);
      await expect(mia.page.getByRole("button", { name: "Add assignment" })).toHaveCount(0);
      await mia.page.goto(`/w/${slug}/schedule/team`);
      await expect(
        mia.page.getByRole("heading", { name: "We couldn't find that page" }),
      ).toBeVisible();
    } finally {
      await mia.context.close();
    }
  });

  test("the project schedule shows total hours and milestones", async ({ page, freshUser }) => {
    const { slug, timezone, name } = freshUser;
    const week = nextWeekDays(timezone);
    await createProjectViaUi(page, slug, "Website");
    await openSchedule(page, slug, "team", week.mon);
    await addAssignmentViaUi(page, {
      project: "Website",
      start: week.mon,
      end: week.tue,
      perDay: "2",
    });
    await addAssignmentViaUi(page, {
      project: "Website",
      start: week.wed,
      end: week.wed,
      total: "3",
    });
    await openSchedule(page, slug, "projects", week.mon);
    const list = page.getByRole("list", { name: "Project schedule" });
    const website = list.getByRole("listitem").filter({ hasText: "Website" });
    await expect(website).toContainText("7:00 assigned");

    await page.getByRole("button", { name: "Add milestone" }).click();
    const dialog = page.getByRole("dialog", { name: "Add milestone" });
    await dialog.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: "Website", exact: true }).click();
    await dialog.getByLabel("Date").fill(week.fri);
    await dialog.getByRole("textbox", { name: "Name" }).fill("Launch");
    await dialog.getByRole("button", { name: "Save milestone" }).click();
    await expect(dialog).toBeHidden();
    await expect(website.getByRole("img", { name: /^Milestone: Launch/ })).toBeVisible();

    await website.getByRole("button", { name: "Expand" }).click();
    await expect(website.getByText(name)).toBeVisible();
    await expect(bar(website, "Website")).toHaveCount(2);
  });

  test("split an assignment from its menu", async ({ page, freshUser }) => {
    const { slug, timezone, name } = freshUser;
    const week = nextWeekDays(timezone);
    await createProjectViaUi(page, slug, "Website");
    await openSchedule(page, slug, "team", week.mon);
    await addAssignmentViaUi(page, {
      project: "Website",
      start: week.mon,
      end: week.fri,
      perDay: "1",
    });
    const row = teamRow(page, name);
    const where = await center(dayCell(row, week.wed));
    await page.mouse.click(where.x, where.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Split here" }).click();
    const bars = bar(row, "Website");
    await expect(bars).toHaveCount(2);
    await expect(bars.first()).toHaveAttribute("data-start", week.mon);
    await expect(bars.first()).toHaveAttribute("data-end", week.tue);
    await expect(bars.nth(1)).toHaveAttribute("data-start", week.wed);
    await expect(bars.nth(1)).toHaveAttribute("data-end", week.fri);
  });
});
