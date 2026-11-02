import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { zonedDateTimeToInstant } from "@timekeep/core";

import { expect, test } from "./fixtures";
import { openTimesheetWeek, runDailyJob } from "./helpers/approvals";
import { waitForApp } from "./helpers/app";
import { waitForEmail } from "./helpers/mail";
import { openSettings } from "./helpers/settings";
import { addTeammate, memberAction, openTeam } from "./helpers/team";
import { importHolidaysViaUi, lastWeek, openTimeOff } from "./helpers/time-off";
import { addManualEntryOn } from "./helpers/tracker";

/**
 * Holidays, the Attendance report, capacity and target reminders (Phase 5b).
 * Nightly lane: each test builds a workspace with teammates or a week of time.
 */

async function openTracker(page: Page, slug: string) {
  await page.goto(`/w/${slug}/tracker`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
}

async function openAttendance(page: Page, slug: string) {
  await page.goto(`/w/${slug}/reports/attendance?preset=last-week`);
  await waitForApp(page);
  await expect(page.getByTestId("report-total")).toBeVisible();
}

/** The person's section of the Attendance tab. */
const personTable = (page: Page, name: string) =>
  page.getByRole("table", { name: `Attendance of ${name}` });

test.describe("attendance", { tag: "@nightly" }, () => {
  test("importing public holidays: review, untick one, import", async ({ page, freshUser }) => {
    const year = new Date().getFullYear() + 1;
    const imported = await importHolidaysViaUi(page, freshUser.slug, {
      country: "PH",
      year,
      untick: "Rizal Day",
    });
    await page.goto(`/w/${freshUser.slug}/time-off?tab=holidays&year=${year}`);
    await waitForApp(page);
    const list = page.getByRole("table", { name: `Holidays in ${year}` });
    await expect(list.getByRole("row", { name: /Bonifacio Day/ })).toBeVisible();
    await expect(list.getByRole("row", { name: /Rizal Day/ })).toHaveCount(0);
    await expect(list.getByRole("row").filter({ hasText: "imported" })).toHaveCount(imported);
  });

  test("a holiday assigned to a group", async ({ page, freshUser, browser, baseURL }) => {
    const { slug, timezone } = freshUser;
    const week = lastWeek(timezone);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await openTeam(page, slug);
    await page.getByRole("tab", { name: "Groups" }).click();
    await page.getByRole("button", { name: "New group" }).click();
    const create = page.getByRole("dialog", { name: "New group" });
    await create.getByLabel("Name").fill("Cebu");
    await create.getByRole("button", { name: "Create group" }).click();
    await expect(create).toBeHidden();
    await page.getByRole("button", { name: "Actions for Cebu" }).click();
    await page.getByRole("menuitem", { name: "Members" }).click();
    const members = page.getByRole("dialog", { name: "Members of Cebu" });
    await members.getByRole("checkbox", { name: "Mia Member" }).check();
    await members.getByRole("button", { name: "Save" }).click();
    await expect(members).toBeHidden();

    await openTimeOff(page, slug, "holidays");
    await page.getByRole("button", { name: "Add holiday" }).click();
    const dialog = page.getByRole("dialog", { name: "New holiday" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("Cebu Day");
    await dialog.getByLabel("Date").fill(week.wednesday);
    await dialog.getByRole("radio", { name: "Some people and groups" }).check();
    await dialog.getByRole("checkbox", { name: "Cebu" }).check();
    await dialog.getByRole("button", { name: "Save holiday" }).click();
    await expect(dialog).toBeHidden();

    await openTimesheetWeek(mia.page, slug, week.start);
    await expect(mia.page.getByRole("row", { name: /Holiday: Cebu Day/ })).toBeVisible();
    await openTimesheetWeek(page, slug, week.start);
    await expect(page.getByRole("row", { name: /Holiday: Cebu Day/ })).toHaveCount(0);
    await mia.context.close();
  });

  test("the Attendance tab shows overtime and exports CSV", async ({ page, freshUser }) => {
    const { slug, timezone, name } = freshUser;
    const week = lastWeek(timezone);
    await openTracker(page, slug);
    await addManualEntryOn(page, {
      description: "Long day",
      date: week.wednesday,
      start: "08:00",
      duration: "9",
    });
    await openAttendance(page, slug);
    const day = personTable(page, name).getByRole("row").filter({ hasText: "9:00:00" });
    await expect(day).toContainText("1:00:00");

    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^timekeep-attendance-.+\.csv$/);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain(
      "Person,Date,First in,Last out,Work,Breaks,Time off,Capacity,Overtime,Undertime,Holiday",
    );
    expect(text).toContain("9:00:00,0:00:00,0:00:00,8:00:00,1:00:00,0:00:00");
    expect(text).toMatch(/Week of /);
  });

  test("capacity on the Team page changes undertime", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const week = lastWeek(timezone);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await openTracker(mia.page, slug);
    await addManualEntryOn(mia.page, {
      description: "Short day",
      date: week.wednesday,
      start: "08:00",
      duration: "6",
    });
    await mia.context.close();

    await openAttendance(page, slug);
    const row = () =>
      personTable(page, "Mia Member").getByRole("row").filter({ hasText: "6:00:00" });
    await expect(row()).toContainText("2:00:00");

    await openTeam(page, slug);
    await memberAction(page, "Mia Member", "Capacity");
    const dialog = page.getByRole("dialog", { name: "Capacity of Mia Member" });
    await dialog.getByRole("textbox", { name: "Daily hours" }).fill("6");
    await dialog.getByRole("textbox", { name: "Weekly hours" }).fill("30");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await openAttendance(page, slug);
    await expect(row()).not.toContainText("2:00:00");
    await expect(row().getByRole("cell", { name: "Undertime" })).toHaveText("0:00:00");
  });

  test("a target reminder email after the daily job", async ({ page, freshUser }) => {
    const { slug, timezone, email } = freshUser;
    const week = lastWeek(timezone);
    await openSettings(page, slug);
    await page.getByRole("button", { name: "Add target" }).click();
    const dialog = page.getByRole("dialog", { name: "New target" });
    await dialog.getByRole("radio", { name: "Tracked too little" }).check();
    await dialog.getByRole("radio", { name: "In a day" }).check();
    await dialog.getByRole("textbox", { name: "Hours" }).fill("8");
    await dialog.getByRole("button", { name: "Save target" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Reminders are sent the next morning.")).toBeVisible();

    await openTracker(page, slug);
    await addManualEntryOn(page, {
      description: "Half day",
      date: week.wednesday,
      start: "08:00",
      duration: "2",
    });
    const morningAfter = zonedDateTimeToInstant(
      { date: week.thursday, hours: 6, minutes: 0 },
      timezone,
    );
    await runDailyJob(page.request, slug, morningAfter);
    const mail = await waitForEmail(email, { subject: /^You tracked 2:00 on / });
    expect(mail.Subject).toContain("You tracked 2:00");
  });
});
