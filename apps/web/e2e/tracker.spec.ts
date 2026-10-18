import { expect, test } from "./fixtures";
import { addManualEntry, entry, timer, today, waitForSaves } from "./helpers/tracker";

/**
 * Time Tracker flows. Every test has its own fresh user and workspace and
 * creates the entries it needs, so tests run in any order. Fixtures are lazy:
 * a test asks for `freshUser` to get an account, even if it only uses
 * `trackerPage`.
 */
test.describe("time tracker", () => {
  test("start, reload and stop a timer", async ({ page, freshUser: _user, trackerPage }) => {
    await trackerPage();
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Design review");
    await timer(page).getByRole("button", { name: "Start" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(page).toHaveTitle(/^0:00:\d\d · Design review$/);

    // The running timer survives a reload.
    await trackerPage();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(timer(page).getByRole("combobox", { name: "Description" })).toHaveValue(
      "Design review",
    );
    await expect(page).toHaveTitle(/^0:00:\d\d · Design review$/);

    await page.waitForTimeout(3_000);
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page).toHaveTitle("Time Tracker · TimeKeep");

    await expect(entry(page, "Design review")).toHaveCount(1);
    await expect(
      entry(page, "Design review").getByRole("textbox", { name: "Duration" }),
    ).toHaveValue(/^0:00:0[3-9]$/);
  });

  test("add a manual entry with a decimal duration", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await timer(page).getByRole("button", { name: "Manual mode" }).click();
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Manual entry");
    const startTime = timer(page).getByRole("textbox", { name: "Start time" });
    await startTime.fill("00:05");
    await startTime.press("Tab");
    const duration = timer(page).getByRole("textbox", { name: "Duration" });
    await duration.fill("1.5");
    await duration.press("Tab");
    await expect(duration).toHaveValue("1:30:00");
    await timer(page).getByRole("button", { name: "Add" }).click();

    await expect(
      entry(page, "Manual entry").getByRole("textbox", { name: "Duration" }),
    ).toHaveValue("1:30:00");
  });

  test("edit a duration inline", async ({ page, freshUser: _user, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Manual entry", start: "00:05", duration: "1.5" });

    const duration = entry(page, "Manual entry").getByRole("textbox", { name: "Duration" });
    await duration.fill("2:00");
    await duration.press("Enter");
    await expect(duration).toHaveValue("2:00:00");
    // The value above is optimistic; wait until the server has confirmed the save.
    await waitForSaves(page);

    await trackerPage();
    await expect(
      entry(page, "Manual entry").getByRole("textbox", { name: "Duration" }),
    ).toHaveValue("2:00:00");
  });

  test("continue an entry", async ({ page, freshUser: _user, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Manual entry", start: "00:05", duration: "1.5" });

    await today(page).getByRole("button", { name: 'Continue "Manual entry"' }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(timer(page).getByRole("combobox", { name: "Description" })).toHaveValue(
      "Manual entry",
    );
    await page.waitForTimeout(1_200);
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();

    // The copy and the original are adjacent and identical, so they collapse.
    const group = today(page).getByRole("group", { name: "Group Manual entry", exact: true });
    await expect(group.getByRole("button", { name: "2 entries" })).toBeVisible();
    await expect(entry(page, "Manual entry")).toHaveCount(0);
    await group.getByRole("button", { name: "2 entries" }).click();
    await expect(entry(page, "Manual entry")).toHaveCount(2);
  });

  test("delete an entry and undo", async ({ page, freshUser: _user, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Design review", start: "00:05", duration: "1" });

    const row = entry(page, "Design review");
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row).toHaveCount(1);

    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText("Entry deleted")).toBeVisible();
    await expect(row).toHaveCount(0);
    await waitForSaves(page);

    await trackerPage();
    await expect(entry(page, "Design review")).toHaveCount(0);
  });

  test("a double Enter or S starts only one timer", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    const description = timer(page).getByRole("combobox", { name: "Description" });
    await description.fill("Double start");
    await description.press("Enter");
    await description.press("Enter");
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await page.waitForTimeout(1_500);
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();

    // Ask the server, not the cache: a second start would have stopped the first after 1 s.
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/w/${freshUser.slug}/time-entries`);
        const body = (await response.json()) as { entries: { description: string }[] };
        return body.entries.filter((e) => e.description === "Double start").length;
      })
      .toBe(1);

    await trackerPage();
    await expect(entry(page, "Double start")).toHaveCount(1);
  });

  test("two tabs never show two running timers", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Manual entry", start: "00:05", duration: "1" });

    const second = await page.context().newPage();
    await second.goto(`/w/${freshUser.slug}/tracker`);
    await expect(second.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();

    await timer(page).getByRole("combobox", { name: "Description" }).fill("Tab one");
    await timer(page).getByRole("button", { name: "Start" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();

    // The other tab picks up the running timer.
    await expect(timer(second).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(timer(second).getByRole("combobox", { name: "Description" })).toHaveValue(
      "Tab one",
    );

    // Starting from the second tab stops the first timer everywhere.
    await today(second).getByRole("button", { name: 'Continue "Manual entry"' }).first().click();
    await expect(timer(second).getByRole("combobox", { name: "Description" })).toHaveValue(
      "Manual entry",
    );
    await expect(timer(page).getByRole("combobox", { name: "Description" })).toHaveValue(
      "Manual entry",
    );
    await expect(entry(page, "Tab one")).toHaveCount(1);
    for (const tab of [page, second]) {
      await expect(tab.getByRole("button", { name: "Stop", exact: true })).toHaveCount(1);
    }

    const running = await page.request.get(`/api/w/${freshUser.slug}/time-entries/running`);
    expect((await running.json()).running.description).toBe("Manual entry");

    await timer(second).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();
    await second.close();
  });
});
