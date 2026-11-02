import { expect, test } from "./fixtures";
import { openTimesheetWeek } from "./helpers/approvals";
import { calendar } from "./helpers/calendar";
import { addTeammate, memberAction, openTeam } from "./helpers/team";
import {
  createPolicyViaUi,
  openTimeOff,
  requestRowIn,
  requestTimeOffViaUi,
  setApprovers,
  timeOffDays,
} from "./helpers/time-off";

/**
 * Time off (Phase 5b): policies, requests and their review, balances, and
 * approved time off on the timesheet and calendar. Each test owns a fresh
 * workspace; requests fall on a Monday and Tuesday of the current year.
 */

test.describe("time off", () => {
  test("time off reduces the balance and shows on the calendar", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const { monday, tuesday, weekStart } = timeOffDays(timezone);
    await createPolicyViaUi(page, slug, { name: "Vacation", allowance: "15" });
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");

    await requestTimeOffViaUi(mia.page, slug, { policy: "Vacation", start: monday, end: tuesday });
    await expect(requestRowIn(mia.page, "My time off", "Vacation")).toContainText("Pending");

    await openTimeOff(page, slug, "requests");
    const row = requestRowIn(page, "To review", "Mia Member");
    await row.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(requestRowIn(page, "Decided", "Mia Member")).toContainText("Approved");

    await openTimeOff(mia.page, slug, "balances");
    await expect(mia.page.getByRole("row", { name: /Vacation/ })).toContainText("13 days");

    await mia.page.goto(`/w/${slug}/calendar?view=week&date=${monday}`);
    await expect(calendar(mia.page)).toBeVisible();
    await expect(mia.page.getByRole("list", { name: "All-day" })).toContainText(
      "Time off: Vacation",
    );

    await openTimesheetWeek(mia.page, slug, weekStart);
    await expect(mia.page.getByRole("row", { name: /Time off: Vacation/ })).toBeVisible();
    await mia.context.close();
  });

  test("a time off request needing approval is approved by a manager", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const { monday } = timeOffDays(timezone);
    await createPolicyViaUi(page, slug, { name: "Vacation", allowance: "15" });
    await setApprovers(page, slug, "Also managers, for the people they manage");
    const max = await addTeammate(page, browser, baseURL, slug, "Max Manager", "Manager");
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await openTeam(page, slug);
    await memberAction(page, "Max Manager", "People and projects");
    const scope = page.getByRole("dialog", { name: "People and projects Max Manager manages" });
    await scope.getByRole("checkbox", { name: "Mia Member" }).check();
    await scope.getByRole("button", { name: "Save" }).click();
    await expect(scope).toBeHidden();

    await requestTimeOffViaUi(mia.page, slug, { policy: "Vacation", start: monday, end: monday });
    await openTimeOff(max.page, slug, "requests");
    const row = requestRowIn(max.page, "To review", "Mia Member");
    await row.getByRole("checkbox").check();
    await max.page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(requestRowIn(max.page, "Decided", "Mia Member")).toContainText("Approved");

    await openTimeOff(mia.page, slug, "requests");
    await expect(requestRowIn(mia.page, "My time off", "Vacation")).toContainText("Approved");
    await max.context.close();
    await mia.context.close();
  });

  test("a rejected request shows its note", async ({ page, freshUser, browser, baseURL }) => {
    const { slug, timezone } = freshUser;
    const { monday } = timeOffDays(timezone);
    await createPolicyViaUi(page, slug, { name: "Vacation", allowance: "15" });
    const mia = await addTeammate(page, browser, baseURL, slug, "Mia Member", "Member");
    await requestTimeOffViaUi(mia.page, slug, { policy: "Vacation", start: monday, end: monday });

    await openTimeOff(page, slug, "requests");
    await requestRowIn(page, "To review", "Mia Member").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Reject…" }).click();
    const dialog = page.getByRole("dialog", { name: "Reject time off" });
    await dialog.getByRole("textbox", { name: "Note" }).fill("Release week");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(dialog).toBeHidden();

    await openTimeOff(mia.page, slug, "requests");
    const mine = requestRowIn(mia.page, "My time off", "Vacation");
    await expect(mine).toContainText("Rejected");
    await expect(mine).toContainText("Release week");
    await mia.context.close();
  });

  test("a policy without approval is approved on submit", async ({ page, freshUser }) => {
    const { slug, timezone } = freshUser;
    const { monday } = timeOffDays(timezone);
    await createPolicyViaUi(page, slug, {
      name: "Sick",
      accrual: "No allowance",
      allowNegative: true,
      requiresApproval: false,
    });
    await requestTimeOffViaUi(page, slug, { policy: "Sick", start: monday, end: monday });
    await expect(requestRowIn(page, "My time off", "Sick")).toContainText("Approved");
  });
});
