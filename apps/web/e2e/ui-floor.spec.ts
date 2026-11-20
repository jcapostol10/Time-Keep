import { expect, test } from "./fixtures";
import { openUserMenu, overflowingElements, waitForApp } from "./helpers/app";

/**
 * The quality floor of the UI (docs/UI.md): nothing is wider than a phone,
 * the keyboard's focus is always visible, and motion stops for people who
 * ask for less of it. Read-only, as the demo owner.
 */

const PAGES = [
  "tracker",
  "timesheet",
  "calendar",
  "dashboard",
  "dashboard?tab=team",
  "reports/summary",
  "reports/detailed",
  "projects",
  "team",
  "clients",
  "expenses",
  "settings",
  "approvals",
  "invoices",
];

test.describe("UI floor", () => {
  test("every main page fits a 375px screen", async ({ page, demoUser }) => {
    test.setTimeout(180_000);
    await demoUser("owner");
    await page.setViewportSize({ width: 375, height: 812 });
    const wide: Record<string, string[]> = {};
    for (const path of PAGES) {
      await page.goto(`/w/demo/${path}`);
      await waitForApp(page);
      // The page itself never scrolls sideways; a table may, inside its own scroller.
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const sticking = await overflowingElements(page);
      if (pageWidth > 375 || sticking.length > 0) {
        wide[path] = [`page ${pageWidth}px`, ...sticking.slice(0, 3)];
      }
    }
    expect(wide).toEqual({});
  });

  test("keyboard focus is visible: a 2px ring, 2px off the element", async ({ page, demoUser }) => {
    await demoUser("owner");
    await page.goto("/w/demo/tracker");
    await waitForApp(page);
    // The sidebar's links, the top bar's buttons, the timer bar's fields: whatever Tab reaches.
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          what: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`,
          width: style.outlineWidth,
          style: style.outlineStyle,
          offset: style.outlineOffset,
        };
      });
      if (!focus) continue;
      seen.push(focus.what);
      expect(focus, focus.what).toMatchObject({ width: "2px", style: "solid", offset: "2px" });
    }
    expect(seen.length).toBeGreaterThan(8);
  });

  test("motion stops for people who ask for less", async ({ page, demoUser }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await demoUser("owner");
    await page.goto("/w/demo/tracker");
    await waitForApp(page);
    await openUserMenu(page);
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const seconds = await menu.evaluate((el) =>
      Math.max(
        ...getComputedStyle(el)
          .animationDuration.split(",")
          .map((d) => Number.parseFloat(d) * (d.trim().endsWith("ms") ? 0.001 : 1)),
      ),
    );
    // Not "none": an animation that ends at once still fires its end event, which Radix waits for.
    expect(seconds).toBeLessThanOrEqual(0.001);
  });
});
