import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import {
  enableApproval,
  openApprovals,
  requestRow,
  submitPeriod,
  weeks,
} from "./helpers/approvals";
import { createProjectViaUi, rowAction } from "./helpers/catalog";
import {
  addCategory,
  addExpense,
  categoryRow,
  expenseAction,
  expenseRow,
  expensesTotal,
  openExpenses,
} from "./helpers/expenses";
import { reportTotal } from "./helpers/reports";
import { addTeammate } from "./helpers/team";
import { addManualEntryOn } from "./helpers/tracker";

/**
 * Expenses (Phase 6c): what a person spent on a project, in the workspace
 * currency, with a receipt; categories are fixed amounts or priced units;
 * expenses join approvals and locks like time; the Expenses report totals them.
 */

const RECEIPT = path.join(__dirname, "fixtures", "avatar.png");

test.describe("expenses", () => {
  test("a fixed expense with a receipt is listed with its thumbnail", async ({
    page,
    freshUser,
  }) => {
    const { slug } = freshUser;
    await createProjectViaUi(page, slug, "Website");
    await addCategory(page, slug, { name: "Travel", kind: "Fixed amount" });
    await addExpense(page, slug, {
      project: "Website",
      category: "Travel",
      amount: "125.50",
      description: "Taxi",
      receipt: RECEIPT,
    });
    const row = expenseRow(page, "Taxi");
    await expect(row).toContainText("$125.50");
    await expect(row).toContainText("Billable");
    const thumb = row.getByRole("img", { name: "Receipt" });
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute("src", /\/receipt\?thumb=1$/);
    await expect(expensesTotal(page)).toContainText("$125.50");
    // The receipt itself opens through the private bucket.
    const res = await page.request.get((await thumb.getAttribute("src")) ?? "", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
  });

  test("a unit category computes the amount from the quantity", async ({ page, freshUser }) => {
    const { slug } = freshUser;
    await createProjectViaUi(page, slug, "Website");
    await addCategory(page, slug, { name: "Mileage", kind: "Per unit", unit: "km", price: "15" });
    await addExpense(page, slug, {
      project: "Website",
      category: "Mileage",
      quantity: "12.5",
      description: "Client visit",
      beforeSave: async (dialog) => {
        await expect(dialog.getByText("× $15.00/km = $187.50")).toBeVisible();
      },
    });
    await expect(expenseRow(page, "Client visit")).toContainText("$187.50");
    await expect(expenseRow(page, "Client visit")).toContainText("12.5 km");

    // A later price change leaves the saved expense at its snapshot.
    await openExpenses(page, slug, "categories");
    await rowAction(page, categoryRow(page, "Mileage"), "Edit");
    const dialog = page.getByRole("dialog", { name: "Edit category" });
    await dialog.getByRole("textbox", { name: /^Price per unit/ }).fill("20");
    await dialog.getByRole("button", { name: "Save category" }).click();
    await expect(dialog).toBeHidden();
    await expect(categoryRow(page, "Mileage")).toContainText("$20.00");
    await openExpenses(page, slug);
    await expect(expenseRow(page, "Client visit")).toContainText("$187.50");
  });

  test("a submitted period locks the member's expenses, and an admin edits with a note", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const { slug, timezone } = freshUser;
    const { last, lastWednesday } = weeks(timezone);
    await enableApproval(page, slug);
    await createProjectViaUi(page, slug, "Website");
    await addCategory(page, slug, { name: "Meals", kind: "Fixed amount", billable: false });
    const mel = await addTeammate(page, browser, baseURL, slug, "Mel Member", "Member");

    await addExpense(mel.page, slug, {
      project: "Website",
      category: "Meals",
      amount: "12",
      date: lastWednesday,
      description: "Lunch",
    });
    await expect(expenseRow(mel.page, "Lunch")).toContainText("Non-billable");
    // Some time in the period too, so the period bar lists it; then submit.
    await mel.page.goto(`/w/${slug}/tracker`);
    await expect(mel.page.locator('main[data-hydrated="true"]')).toBeVisible();
    await addManualEntryOn(mel.page, {
      description: "Work",
      date: lastWednesday,
      start: "09:00",
      duration: "1",
    });
    await submitPeriod(mel.page, slug, last);

    // The member's row is locked and says why.
    await openExpenses(mel.page, slug);
    const locked = expenseRow(mel.page, "Lunch");
    await expect(
      locked.getByRole("img", { name: "This period is submitted for approval." }),
    ).toBeVisible();
    await expect(locked.getByRole("button", { name: "More actions" })).toBeDisabled();

    // The owner changes it with a note.
    await openExpenses(page, slug);
    await expenseAction(page, "Lunch", "Edit");
    const dialog = page.getByRole("dialog", { name: "Edit expense" });
    await dialog.getByRole("textbox", { name: /^Amount/ }).fill("30");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    const prompt = page.getByRole("dialog", { name: "Why are you changing submitted time?" });
    await prompt.getByRole("textbox", { name: "Note" }).fill("The receipt said 30");
    await prompt.getByRole("button", { name: "Save change" }).click();
    await expect(prompt).toBeHidden();
    await expect(dialog).toBeHidden();
    await expect(expenseRow(page, "Lunch")).toContainText("$30.00");

    // The period page lists the expense and the change.
    await openApprovals(page, slug, "pending");
    await requestRow(page, "Mel Member", last).getByRole("link").first().click();
    await waitForApp(page);
    await expect(page.getByRole("region", { name: "Expenses" })).toContainText("Lunch");
    await expect(page.getByRole("region", { name: "Expenses" })).toContainText("$30.00");
    await expect(page.getByRole("region", { name: "History" })).toContainText("changed an expense");
    await expect(page.getByRole("region", { name: "History" })).toContainText(
      "The receipt said 30",
    );
    await mel.context.close();
  });

  test("the Expenses report totals by category and exports a CSV", async ({ page, freshUser }) => {
    const { slug } = freshUser;
    await createProjectViaUi(page, slug, "Website");
    await addCategory(page, slug, { name: "Travel", kind: "Fixed amount" });
    await addCategory(page, slug, { name: "Meals", kind: "Fixed amount", billable: false });
    await addExpense(page, slug, {
      project: "Website",
      category: "Travel",
      amount: "100",
      description: "Flight",
    });
    await addExpense(page, slug, {
      project: "Website",
      category: "Travel",
      amount: "25.50",
      description: "Taxi",
    });
    await addExpense(page, slug, {
      project: "Website",
      category: "Meals",
      amount: "20",
      description: "Lunch",
    });

    await page.goto(`/w/${slug}/reports/expenses`);
    await waitForApp(page);
    await expect(reportTotal(page)).toHaveText("$145.50");
    const table = page.getByRole("table", { name: "Expenses report" });
    const travel = table.getByRole("row", { name: /^Travel/ });
    await expect(travel).toContainText("2");
    await expect(travel).toContainText("$125.50");
    await expect(table.getByRole("row", { name: /^Meals/ })).toContainText("$20.00");

    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "CSV" }).click(),
    ]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain("Category,Expenses,Amount (USD),Billable (USD)");
    expect(text).toContain("Travel,2,125.50,125.50");
    expect(text).toContain("Meals,1,20.00,0.00");

    await page.getByRole("combobox", { name: "Group by" }).click();
    await page.getByRole("option", { name: "Project", exact: true }).click();
    await expect(table.getByRole("row", { name: /^Website/ })).toContainText("$145.50");
    await expect(table.getByRole("row", { name: /^Travel/ })).toHaveCount(0);
  });

  test("a member sees only their own expenses", async ({ page, freshUser, browser, baseURL }) => {
    const { slug } = freshUser;
    await createProjectViaUi(page, slug, "Website");
    await addCategory(page, slug, { name: "Travel", kind: "Fixed amount" });
    const mel = await addTeammate(page, browser, baseURL, slug, "Mel Member", "Member");
    await addExpense(page, slug, {
      project: "Website",
      category: "Travel",
      amount: "40",
      description: "Owner's taxi",
    });
    await addExpense(mel.page, slug, {
      project: "Website",
      category: "Travel",
      amount: "15",
      description: "Mel's bus",
    });

    await expect(expenseRow(mel.page, "Mel's bus")).toBeVisible();
    await expect(expenseRow(mel.page, "Owner's taxi")).toHaveCount(0);
    await expect(expensesTotal(mel.page)).toContainText("$15.00");
    await mel.page.goto(`/w/${slug}/reports/expenses`);
    await waitForApp(mel.page);
    await expect(reportTotal(mel.page)).toHaveText("$15.00");

    await openExpenses(page, slug);
    await expect(expenseRow(page, "Owner's taxi")).toBeVisible();
    await expect(expenseRow(page, "Mel's bus")).toBeVisible();
    await expect(expensesTotal(page)).toContainText("$55.00");
    await mel.context.close();
  });
});
