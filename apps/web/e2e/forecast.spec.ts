import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { createProjectViaUi } from "./helpers/catalog";
import { openBudget, setEstimate } from "./helpers/budgets";
import {
  addAssignmentViaUi,
  nextWeekDays,
  openSchedule,
  publishSchedule,
  todayKey,
} from "./helpers/schedule";
import { addManualEntry, pickProject } from "./helpers/tracker";

/**
 * The forecast and the Assignments report (Phase 7b): the published plan
 * against the estimate on the Budget tab, and against tracked time in Reports.
 */

test.describe("forecast and assignments report", () => {
  test("the forecast predicts an overrun when scheduled plus tracked exceeds the estimate", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    const { slug, timezone } = freshUser;
    const week = nextWeekDays(timezone);
    await createProjectViaUi(page, slug, "Website");
    await trackerPage();
    await pickProject(page, "Website");
    await addManualEntry(page, { description: "Build", start: "00:05", duration: "4" });
    await openSchedule(page, slug, "team", week.mon);
    await addAssignmentViaUi(page, {
      project: "Website",
      start: week.mon,
      end: week.tue,
      perDay: "8",
    });
    await publishSchedule(page);
    await openBudget(page, slug, "Website");
    await setEstimate(page, { kind: "Time", amount: "10" });
    const forecast = page.getByRole("region", { name: "Forecast" });
    // 4 h tracked + 16 h scheduled against 10 h: 10 h over, reached on the first scheduled day.
    await expect(forecast.getByTestId("forecast-overrun")).toContainText("10:00:00");
    await expect(forecast.getByTestId("forecast-completion")).toHaveAttribute(
      "data-date",
      week.mon,
    );
  });

  test("the Assignments report shows scheduled against tracked with the variance, and its CSV", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    const { slug, timezone, name } = freshUser;
    const today = todayKey(timezone);
    await createProjectViaUi(page, slug, "Website");
    await openSchedule(page, slug, "team", today);
    await addAssignmentViaUi(page, {
      project: "Website",
      start: today,
      end: today,
      perDay: "2",
      nonWorking: true,
    });
    await publishSchedule(page);
    await trackerPage();
    await pickProject(page, "Website");
    await addManualEntry(page, { description: "Build", start: "00:05", duration: "1.5" });

    await page.goto(`/w/${slug}/reports/assignments?preset=today`);
    await waitForApp(page);
    const table = page.getByRole("table", { name: "Assignments report" });
    const row = table.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("2:00:00");
    await expect(row).toContainText("1:30:00");
    await expect(row).toContainText("−0:30:00");

    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "CSV" }).click(),
    ]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text.replace(/^﻿/, "").split("\r\n")[0]).toBe(
      "Person,Scheduled,Tracked,Variance,Variance %",
    );
    expect(text).toContain(`${name},2:00:00,1:30:00,−0:30:00,-25.0`);
  });
});
