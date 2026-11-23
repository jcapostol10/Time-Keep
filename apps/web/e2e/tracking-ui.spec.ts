import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { overflowingElements } from "./helpers/app";
import { addTeammate } from "./helpers/team";
import { addManualEntry, createProject, entry, timer, today } from "./helpers/tracker";

/**
 * How time tracking looks (docs/UI.md): the running clock is the one bold
 * element, a day is drawn as a ribbon, and the tools stay within reach. These
 * guard the look where it carries meaning; behaviour is tested elsewhere.
 */

/** A token's colour as the browser computes it, for comparing with an element's. */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);
}

/** Relative lightness of an `rgb()` colour: enough to say which of two surfaces is lighter. */
function luminance(colour: string): number {
  const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const style = (locator: Locator, property: string) =>
  locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("no bounding box");
  return rect;
}

test.describe("tracking UI", () => {
  test("the timer bar stays under the top bar while the list scrolls", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await trackerPage();
    for (const [i, name] of ["One", "Two", "Three", "Four", "Five"].entries()) {
      await addManualEntry(page, {
        description: name,
        start: `00:${10 + i * 5}`,
        duration: "0:03",
      });
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const header = await box(page.getByRole("banner"));
    const bar = await box(timer(page));
    // Stuck directly under the top bar, not scrolled away with the list.
    expect(Math.abs(bar.y - (header.y + header.height))).toBeLessThanOrEqual(1);
  });

  test("a running timer turns the bar live: an amber Stop, a top border and a dot by the clock", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    const bar = timer(page);
    const clock = bar.getByRole("timer", { name: "Elapsed time" });
    const idleColour = await style(clock, "color");
    expect(await style(clock, "font-size")).toBe("32px");
    expect(await style(bar, "border-top-width")).toBe("1px");
    await expect(bar.locator("[data-live-dot]")).toHaveCount(0);

    await bar.getByRole("combobox", { name: "Description" }).fill("Live look");
    await bar.getByRole("button", { name: "Start" }).click();
    const stop = bar.getByRole("button", { name: "Stop" });
    await expect(stop).toBeVisible();

    // Off the button: its hover shade is not what is being checked.
    await page.mouse.move(0, 0);
    await expect
      .poll(() => style(stop, "background-color"))
      .toBe(await tokenColour(page, "--live"));
    expect(await style(bar, "border-top-width")).toBe("2px");
    expect(await style(bar, "border-top-color")).toBe(await tokenColour(page, "--live-line"));
    await expect(bar.locator("[data-live-dot]")).toBeVisible();
    // Idle the clock is muted; running it is ink.
    expect(await style(clock, "color")).not.toBe(idleColour);
    expect(await style(clock, "color")).toBe(await tokenColour(page, "--foreground"));

    await stop.click();
    await expect(bar.getByRole("button", { name: "Start" })).toBeVisible();
    expect(await style(bar, "border-top-width")).toBe("1px");
    await expect(bar.locator("[data-live-dot]")).toHaveCount(0);
  });

  test("on a phone the description has the first row; pickers, clock and Start share the second", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await trackerPage();
    const bar = timer(page);
    // The bar at its fullest: a long project name, and the timer running (the dot).
    await createProject(page, "A project with quite a long name");
    await bar.getByRole("combobox", { name: "Description" }).fill("Phone");
    await bar.getByRole("button", { name: "Start" }).click();
    await expect(bar.getByRole("button", { name: "Stop" })).toBeVisible();
    const barBox = await box(bar);
    const description = await box(bar.getByRole("combobox", { name: "Description" }));
    const project = await box(bar.getByRole("button", { name: /^Project:/ }));
    const clock = await box(bar.getByRole("timer", { name: "Elapsed time" }));
    const start = await box(bar.getByRole("button", { name: "Stop" }));
    const mode = await box(bar.getByRole("group", { name: "Entry mode" }));

    expect(description.width).toBeGreaterThan(barBox.width - 24);
    const centre = (rect: { y: number; height: number }) => rect.y + rect.height / 2;
    // One second row: the three share a centre line, below the description.
    expect(Math.abs(centre(project) - centre(start))).toBeLessThanOrEqual(2);
    expect(Math.abs(centre(clock) - centre(start))).toBeLessThanOrEqual(2);
    expect(start.y).toBeGreaterThanOrEqual(description.y + description.height - 1);
    // Nothing overlaps and nothing leaves the bar.
    expect(project.x + project.width).toBeLessThanOrEqual(clock.x + 1);
    expect(clock.x + clock.width).toBeLessThanOrEqual(start.x + 1);
    expect(mode.x + mode.width).toBeLessThanOrEqual(barBox.x + barBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    expect(await overflowingElements(page)).toEqual([]);
  });

  test("Import and Bulk edit live in the list's menu, also on an empty tracker", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    // No row of its own: the only way in is the menu.
    await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "List actions" }).click();
    // Nothing ticked: Bulk edit is there, switched off.
    await expect(page.getByRole("menuitem", { name: "Bulk edit…" })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Import…" }).click();
    const dialog = page.getByRole("dialog", { name: "Import time entries" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await addManualEntry(page, { description: "Tick me", start: "00:10", duration: "0:05" });
    await page.getByRole("checkbox", { name: "Select Tick me" }).click();
    await page.getByRole("button", { name: "List actions" }).click();
    await page.getByRole("menuitem", { name: "Bulk edit…" }).click();
    await expect(page.getByRole("dialog", { name: /Edit 1 entr/ })).toBeVisible();
  });

  test("the timer bar's Start is the only filled button on the tracker", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
    const filled = await page
      .getByRole("main")
      .locator('button[data-variant="default"]')
      .evaluateAll((els) => els.map((el) => el.textContent?.trim()));
    expect(filled).toEqual(["Start"]);
  });
  test("a day is drawn as a ribbon, with a summary for people who do not see it", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Early", start: "00:10", duration: "0:05" });
    await addManualEntry(page, { description: "Later", start: "00:30", duration: "0:10" });
    const day = today(page);
    const ribbon = day.locator("[data-ribbon]");
    await expect(ribbon).toHaveCount(1);
    expect(await style(ribbon.locator("[data-ribbon-track]"), "height")).toBe("4px");

    // Two blocks, placed by the clock: 00:10 is 10/1440 of the day from its left edge.
    const blocks = ribbon.locator("[data-ribbon-block]");
    await expect(blocks).toHaveCount(2);
    expect(await blocks.first().evaluate((el) => (el as HTMLElement).style.left)).toBe("0.694%");
    expect(await blocks.nth(1).evaluate((el) => (el as HTMLElement).style.left)).toBe("2.083%");

    // The strip is hidden from assistive technology; the summary speaks for it.
    await expect(ribbon.locator("[data-ribbon-track]")).toHaveAttribute("aria-hidden", "true");
    await expect(ribbon).toHaveAccessibleName(
      /^2 entries, 0:15(:00)? tracked between (00:10|12:10 AM) and (00:40|12:40 AM)$/,
    );

    // Pointing at a block says what it is.
    await blocks.first().hover();
    await expect(page.getByRole("tooltip")).toContainText("Early");
    await page.mouse.move(0, 0);

    // A click on the ribbon pins nothing open; the keyboard opens the day's list.
    await ribbon.click({ position: { x: 300, y: 8 } });
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await day.getByRole("checkbox", { name: /^Select all entries/ }).focus();
    await page.keyboard.press("Tab");
    await expect(ribbon).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText("Later");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // The day's total sits at the right of the header in the display face.
    const total = day.locator("[data-day-total]");
    await expect(total).toHaveText(/0:15(:00)?/);
    expect(await style(total, "font-size")).toBe("20px");

    // A running timer is a live block on today.
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Now");
    await timer(page).getByRole("button", { name: "Start" }).click();
    const running = ribbon.locator("[data-ribbon-running]");
    await expect(running).toBeVisible();
    expect(await style(running.locator("span"), "background-color")).toBe(
      await tokenColour(page, "--live-line"),
    );
    await expect(ribbon).toHaveAccessibleName(/, timer running$/);
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(running).toHaveCount(0);
  });
  test("entry rows have no lines between them, share their columns and show actions on hover or focus", async ({
    page,
    freshUser: _user,
    trackerPage,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await trackerPage();
    await addManualEntry(page, { description: "Short", start: "00:10", duration: "0:05" });
    await createProject(page, "Website redesign");
    await addManualEntry(page, {
      description: "A much longer description of the work that was done",
      start: "00:30",
      duration: "0:10",
    });
    const short = entry(page, "Short");
    const long = entry(page, "A much longer description of the work that was done");

    // No line between rows, 12px above and below.
    for (const row of [short, long]) {
      expect(await style(row, "border-top-width")).toBe("0px");
      expect(await style(row, "border-bottom-width")).toBe("0px");
      expect(await style(row, "padding-top")).toBe("12px");
      expect(await style(row, "padding-bottom")).toBe("12px");
    }

    // Columns line up whatever the rows hold.
    const x = async (row: Locator, role: "button" | "textbox", name: string | RegExp) =>
      Math.round((await box(row.getByRole(role, { name }))).x);
    for (const [role, name] of [
      ["button", /^Project:/],
      ["button", /^Tags:/],
      ["button", "Billable"],
      ["textbox", "Start time"],
      ["textbox", "Duration"],
    ] as const) {
      expect(await x(short, role, name), String(name)).toBe(await x(long, role, name));
    }
    // A group row (two identical entries in a row) keeps the same time and duration columns.
    await timer(page)
      .getByRole("button", { name: /^Project:/ })
      .click();
    await page.getByRole("option", { name: "No project" }).click();
    await addManualEntry(page, { description: "Twice", start: "01:00", duration: "0:05" });
    await addManualEntry(page, { description: "Twice", start: "01:10", duration: "0:05" });
    const group = today(page).getByRole("group", { name: "Group Twice", exact: true });
    const centre = async (locator: Locator) => {
      const rect = await box(locator);
      return Math.round(rect.x + rect.width / 2);
    };
    expect(
      Math.abs(
        (await centre(group.locator("[data-range-start]"))) -
          (await centre(short.getByRole("textbox", { name: "Start time" }))),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (await centre(group.locator("[data-group-total]"))) -
          (await centre(short.getByRole("textbox", { name: "Duration" }))),
      ),
    ).toBeLessThanOrEqual(1);

    // The description is never squeezed out by the columns: here, and on a narrower screen.
    const description = long.getByRole("textbox", { name: "Description" });
    expect((await box(description)).width).toBeGreaterThanOrEqual(160);
    await page.setViewportSize({ width: 1300, height: 900 });
    expect((await box(description)).width).toBeGreaterThanOrEqual(200);
    await page.setViewportSize({ width: 1440, height: 900 });

    const duration = short.getByRole("textbox", { name: "Duration" });
    expect(await style(duration, "font-size")).toBe("14px");
    expect(await style(duration, "font-weight")).toBe("600");

    // Actions wait for the pointer or the keyboard.
    const actions = short.locator("[data-row-actions]");
    await page.mouse.move(0, 0);
    await expect.poll(() => style(actions, "opacity")).toBe("0");
    await short.hover();
    await expect.poll(() => style(actions, "opacity")).toBe("1");
    await page.mouse.move(0, 0);
    await expect.poll(() => style(actions, "opacity")).toBe("0");
    await short.getByRole("textbox", { name: "Description" }).focus();
    await expect.poll(() => style(actions, "opacity")).toBe("1");
  });

  test("on a touch screen the row actions are always there", async ({
    browser,
    page: signedIn,
    freshUser,
  }) => {
    // A phone: no hover to wait for. Same account, its own context.
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 375, height: 812 },
      storageState: await signedIn.context().storageState(),
    });
    const page = await context.newPage();
    await page.goto(`/w/${freshUser.slug}/tracker`);
    await expect(timer(page)).toHaveAttribute("data-hydrated", "true");
    await addManualEntry(page, { description: "Touch", start: "00:10", duration: "0:05" });
    expect(await style(entry(page, "Touch").locator("[data-row-actions]"), "opacity")).toBe("1");
    await context.close();
  });
  test("the timesheet marks today, keeps 44px cells and bold totals, and pins its header and first column", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Sheet", start: "00:10", duration: "0:05" });
    await page.goto(`/w/${freshUser.slug}/timesheet`);
    const sheet = page.getByRole("grid", { name: "Timesheet" });
    await expect(sheet).toHaveAttribute("data-hydrated", "true");

    // Today: a primary date label and a faint tint down the column.
    const todayHead = sheet.locator('thead th[data-today="true"]');
    await expect(todayHead).toHaveCount(1);
    expect(await style(todayHead, "color")).toBe(await tokenColour(page, "--primary"));
    const clear = "rgba(0, 0, 0, 0)";
    const todayCell = sheet.locator('tbody td[data-today="true"]').first();
    expect(await style(todayCell, "background-color")).not.toBe(clear);
    expect(
      await style(sheet.locator("tbody td:not([data-today])").first(), "background-color"),
    ).toBe(clear);

    // Cells are 44px tall; totals are 600.
    expect(Math.round((await box(todayCell)).height)).toBe(44);
    const weights = await sheet
      .locator('td[aria-label^="Total "]')
      .evaluateAll((cells) => cells.map((c) => getComputedStyle(c).fontWeight));
    expect(weights.length).toBeGreaterThan(7);
    expect(new Set(weights)).toEqual(new Set(["600"]));

    // The header row and the first column are pinned inside the grid's own scroller.
    const head = sheet.locator("thead th").nth(1);
    expect(await style(head, "position")).toBe("sticky");
    expect(await style(head, "top")).toBe("0px");
    const rowHead = sheet.locator("tbody th[scope=row]").first();
    expect(await style(rowHead, "position")).toBe("sticky");

    // On a phone the grid scrolls sideways in its frame and the row's name stays put.
    await page.setViewportSize({ width: 375, height: 812 });
    const scroller = page.locator("[data-timesheet-scroller]");
    const before = await box(rowHead);
    const scrolled = await scroller.evaluate((el) => {
      el.scrollLeft = 300;
      return { left: el.scrollLeft, overflowY: getComputedStyle(el).overflowY };
    });
    expect(scrolled.left).toBeGreaterThan(100);
    expect(scrolled.overflowY).toBe("auto");
    expect(Math.round((await box(rowHead)).x)).toBe(Math.round(before.x));
    // The name leaves most of the phone's width to the days.
    expect(before.width).toBeLessThanOrEqual(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
  });
  test("the calendar opens on now, with a live now-line and lighter working hours", async ({
    page,
    freshUser,
  }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto(`/w/${freshUser.slug}/calendar`);
    const calendar = page.locator("[data-calendar]");
    await expect(calendar).toHaveAttribute("data-hydrated", "true");

    // Now is in the middle of what the calendar shows, not wherever 07:00 leaves it.
    const line = calendar.getByTestId("now-line");
    await expect(line).toBeVisible();
    const scroller = await box(calendar.locator("[data-scroll]"));
    await expect
      .poll(async () => Math.abs((await box(line)).y - (scroller.y + scroller.height / 2)))
      .toBeLessThan(24);
    expect(await style(line, "border-top-color")).toBe(await tokenColour(page, "--live-line"));
    await expect(line.locator("span")).toHaveCount(1);

    // 08:00 to 18:00 is the working day: lighter than the hours around it, in both themes.
    const day = calendar.locator("[data-day]").filter({ has: page.getByTestId("now-line") });
    const working = day.locator("[data-working-hours]");
    await expect(working).toHaveCount(1);
    expect(
      await working.evaluate((el) => [
        (el as HTMLElement).offsetTop,
        (el as HTMLElement).offsetHeight,
      ]),
    ).toEqual([512, 640]);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect
        .poll(async () => luminance(await style(working, "background-color")), { message: scheme })
        .toBeGreaterThan(luminance(await tokenColour(page, "--background")));
    }
  });
  test("another person's day ribbon does not show the viewer's own running timer", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await mia.context.close();
    await page.goto(`/w/${freshUser.slug}/tracker`);
    await expect(timer(page)).toHaveAttribute("data-hydrated", "true");
    await page.getByRole("combobox", { name: "Person", exact: true }).click();
    await page.getByRole("option", { name: "Mia Member", exact: true }).click();
    await expect(page).toHaveURL(/user=/);
    await expect(timer(page)).toHaveAttribute("data-hydrated", "true");
    await addManualEntry(page, { description: "For Mia", start: "00:05", duration: "0:10" });
    const ribbon = today(page).locator("[data-ribbon]");
    await expect(ribbon).toHaveCount(1);

    // The timer in the bar is the viewer's; Mia's day has nothing running.
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Mine");
    await timer(page).getByRole("button", { name: "Start" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(ribbon.locator("[data-ribbon-block]")).toHaveCount(1);
    await expect(ribbon.locator("[data-ribbon-running]")).toHaveCount(0);
    await expect(ribbon).not.toHaveAccessibleName(/timer running/);
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();
  });
});
