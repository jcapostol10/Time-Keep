import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { overflowingElements } from "./helpers/app";
import { addManualEntry, createProject, timer, today } from "./helpers/tracker";

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
    await expect(
      ribbon.getByText(
        /^2 entries, 0:15(:00)? tracked between (00:10|12:10 AM) and (00:40|12:40 AM)$/,
      ),
    ).toHaveCount(1);

    // Pointing at a block says what it is.
    await blocks.first().hover();
    await expect(page.getByRole("tooltip")).toContainText("Early");
    await page.mouse.move(0, 0);

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
    await expect(ribbon.getByText(/, timer running$/)).toHaveCount(1);
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(running).toHaveCount(0);
  });
});
