import type { Page } from "@playwright/test";
import { formatPeriod, type Period, zonedDateTimeToInstant } from "@timekeep/core";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import {
  enableApproval,
  noonOn,
  openApprovals,
  openTimesheetWeek,
  periodGroup,
  requestRow,
  runDailyJob,
  setRollingLock,
  submitPeriod,
  weeks,
} from "./helpers/approvals";
import { waitForEmail } from "./helpers/mail";
import { addTeammate } from "./helpers/team";
import { cell, dayLabel } from "./helpers/timesheet";
import { addManualEntryOn, timer, waitForSaves } from "./helpers/tracker";

/**
 * Approvals and lock dates (Phase 5a): people submit a week of their time,
 * an approver approves or rejects it; approved time is read-only for its
 * owner and an admin changes it only with a note; a lock date blocks
 * members' changes to old days. The fresh owner's workspace is in their own
 * zone, with Monday weeks.
 */

async function openTracker(page: Page, slug: string) {
  await page.goto(`/w/${slug}/tracker`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
}

/** An older entry's row in the tracker list, loading older weeks until it shows. */
async function revealRow(page: Page, description: string) {
  const row = page.getByRole("group", { name: `Entry ${description}`, exact: true });
  const more = page.getByRole("button", { name: "Load more" });
  // The list also loads older weeks by itself when its end scrolls into view.
  await expect(async () => {
    if (!(await row.isVisible()) && (await more.isVisible())) await more.click({ timeout: 2_000 });
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return row;
}

async function addLastWeek(page: Page, slug: string, tz: string, description: string) {
  await openTracker(page, slug);
  await addManualEntryOn(page, {
    description,
    date: weeks(tz).lastWednesday,
    start: "09:00",
    duration: "2",
  });
}

async function approve(page: Page, slug: string, name: string, p: Period) {
  await openApprovals(page, slug);
  const row = requestRow(page, name, p);
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(row).toBeHidden();
}

test.describe("approvals and locks", () => {
  test("an approved week cannot be edited by its member", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const { last, lastWednesday } = weeks(timezone);
    await enableApproval(page, slug);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await addLastWeek(mia.page, slug, timezone, "Approved work");
    await submitPeriod(mia.page, slug, last);
    await approve(page, slug, "Mia Member", last);

    // The timesheet: the period says so and its cells are read-only.
    await openTimesheetWeek(mia.page, slug, last.start);
    await expect(periodGroup(mia.page, last)).toContainText("Approved");
    const day = dayLabel(noonOn(lastWednesday, timezone), timezone);
    await expect(cell(mia.page, "No project · Approved work", day)).toHaveAttribute("readonly", "");

    // The tracker row: every field disabled.
    await openTracker(mia.page, slug);
    const row = await revealRow(mia.page, "Approved work");
    await expect(row.getByRole("textbox", { name: "Description" })).toBeDisabled();

    // A crafted import into the week is refused by the server.
    const csv = `Date,Start,Duration,Description\n${lastWednesday},14:00,1:00,Sneaked in\n`;
    const options = {
      timezone,
      dateFormat: "yyyy-MM-dd",
      createMissing: false,
      mapping: { date: 0, start: 1, duration: 2, description: 3 },
    };
    const file = { name: "time.csv", mimeType: "text/csv", buffer: Buffer.from(csv) };
    const dry = await mia.page.request.post(`/api/w/${slug}/time-entries/import?dryRun=1`, {
      multipart: { file, options: JSON.stringify(options) },
    });
    expect(dry.ok()).toBe(true);
    const { fingerprint } = (await dry.json()) as { fingerprint: string };
    const commit = await mia.page.request.post(`/api/w/${slug}/time-entries/import`, {
      multipart: { file, options: JSON.stringify({ ...options, fingerprint }) },
    });
    expect(commit.status()).toBe(400);
    expect(((await commit.json()) as { error: string }).error).toBe("This period is approved.");
    await mia.context.close();
  });

  test("submit, withdraw and resubmit after a rejection", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const { last } = weeks(timezone);
    await enableApproval(page, slug);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await addLastWeek(mia.page, slug, timezone, "Some work");
    await submitPeriod(mia.page, slug, last);

    const group = periodGroup(mia.page, last);
    await group.getByRole("button", { name: "Withdraw" }).click();
    await expect(group).toContainText("Not submitted");
    await group.getByRole("button", { name: "Submit for approval" }).click();
    await expect(group).toContainText("Pending approval");

    await openApprovals(page, slug);
    await requestRow(page, "Mia Member", last).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reject 1 period" });
    await dialog.getByRole("textbox", { name: "Note" }).fill("Add Friday's meeting");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog).toBeHidden();

    await openTimesheetWeek(mia.page, slug, last.start);
    await expect(group).toContainText("Rejected");
    await expect(group).toContainText("Add Friday's meeting");
    await group.getByRole("button", { name: "Resubmit" }).click();
    await expect(group).toContainText("Pending approval");
    await mia.context.close();
  });

  test("bulk approve from the Pending tab", async ({ page, freshUser, browser, baseURL }) => {
    const { slug, timezone, name } = freshUser;
    const { last } = weeks(timezone);
    await enableApproval(page, slug);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await addLastWeek(mia.page, slug, timezone, "Mia's week");
    await submitPeriod(mia.page, slug, last);
    // An owner submits their own week too, and may approve it.
    await addLastWeek(page, slug, timezone, "Owner's week");
    await submitPeriod(page, slug, last);

    await openApprovals(page, slug);
    await page.getByRole("checkbox", { name: "Select all" }).check();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("2 periods approved")).toBeVisible();
    await expect(requestRow(page, "Mia Member", last)).toBeHidden();

    await page.getByRole("tab", { name: "Archive" }).click();
    await expect(requestRow(page, "Mia Member", last)).toContainText("Approved");
    await expect(requestRow(page, name, last)).toContainText("Approved");
    await mia.context.close();
  });

  test("approval emails reach approvers and the member", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone, email } = freshUser;
    const { last } = weeks(timezone);
    await enableApproval(page, slug);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await addLastWeek(mia.page, slug, timezone, "Emailed work");
    await submitPeriod(mia.page, slug, last);
    const when = formatPeriod(last);
    await waitForEmail(email, { subject: new RegExp(`Mia Member submitted ${when} for approval`) });
    await approve(page, slug, "Mia Member", last);
    await waitForEmail(mia.user.email, {
      subject: new RegExp(`Your time for ${when} was approved`),
    });
    await mia.context.close();
  });

  test("an admin edits approved time with a note", async ({ page, freshUser }) => {
    const { slug, timezone, name } = freshUser;
    const { last } = weeks(timezone);
    await enableApproval(page, slug);
    await addLastWeek(page, slug, timezone, "Owner's approved work");
    await submitPeriod(page, slug, last);
    await approve(page, slug, name, last);

    // The owner changes the approved entry from the timesheet's entry dialog: a note is asked for.
    await openTimesheetWeek(page, slug, last.start);
    const day = dayLabel(noonOn(weeks(timezone).lastWednesday, timezone), timezone);
    const input = cell(page, "No project · Owner's approved work", day);
    await input.fill("3:00");
    await input.press("Enter");
    const prompt = page.getByRole("dialog", { name: "Why are you changing submitted time?" });
    await prompt.getByRole("textbox", { name: "Note" }).fill("The client added an hour");
    await prompt.getByRole("button", { name: "Save change" }).click();
    await expect(prompt).toBeHidden();
    await waitForSaves(page);
    await expect(input).toHaveValue("3:00:00");

    await openApprovals(page, slug, "archive");
    await requestRow(page, name, last).getByRole("link").first().click();
    await waitForApp(page);
    await expect(page.getByRole("region", { name: "History" })).toContainText(
      "The client added an hour",
    );
  });

  test("a rolling lock blocks a member, not an admin", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const { lastWednesday } = weeks(timezone);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await setRollingLock(page, slug, 1);

    await openTracker(mia.page, slug);
    await timer(mia.page).getByRole("button", { name: "Manual mode" }).click();
    await timer(mia.page).getByRole("combobox", { name: "Description" }).fill("Too late");
    await timer(mia.page).getByRole("textbox", { name: "Date" }).fill(lastWednesday);
    const start = timer(mia.page).getByRole("textbox", { name: "Start time" });
    await start.fill("09:00");
    await start.press("Tab");
    const duration = timer(mia.page).getByRole("textbox", { name: "Duration" });
    await duration.fill("1");
    await duration.press("Tab");
    await timer(mia.page).getByRole("button", { name: "Add" }).click();
    await expect(mia.page.getByText(/^Entries before .* are locked\.$/)).toBeVisible();

    // The owner is never locked.
    await addLastWeek(page, slug, timezone, "Owner's late entry");
    await revealRow(page, "Owner's late entry");
    await mia.context.close();
  });

  test("the daily job reminds an unsubmitted period", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const { current, last } = weeks(timezone);
    await enableApproval(page, slug);
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await addLastWeek(mia.page, slug, timezone, "Forgotten week");
    // The job runs early on the first day after the week, in the workspace's zone.
    await runDailyJob(
      page.request,
      slug,
      zonedDateTimeToInstant({ date: current.start, hours: 6, minutes: 0 }, timezone),
    );
    await waitForEmail(mia.user.email, {
      subject: new RegExp(`Submit your time for ${formatPeriod(last)}`),
    });
    await mia.context.close();
  });
});
