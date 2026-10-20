import { expect, type Locator, type Page } from "@playwright/test";

/** Pointer helpers for the calendar grid. 16px per 15-minute slot, 64px per hour. */
export const SLOT_PX = 16;

export const calendar = (page: Page) => page.locator('[data-calendar][data-hydrated="true"]');
export const dayColumn = (page: Page, dayKey: string) => page.locator(`[data-day="${dayKey}"]`);
export const block = (page: Page, name: string | RegExp) =>
  calendar(page).getByRole("button", { name });

/** Scrolls the grid so `minutes` (from midnight) sits near the top of the view. */
export async function scrollToMinutes(page: Page, minutes: number) {
  await calendar(page)
    .locator("[data-scroll]")
    .evaluate(
      (el, top) => {
        el.scrollTop = top;
      },
      (minutes / 15) * SLOT_PX - 40,
    );
}

/** Viewport coordinates of a minute of a day column (scroll first so it is visible). */
export async function dayPoint(page: Page, dayKey: string, minutes: number) {
  const box = await dayColumn(page, dayKey).boundingBox();
  if (!box) throw new Error(`day column ${dayKey} not found`);
  return { x: box.x + box.width / 2, y: box.y + (minutes / 15) * SLOT_PX };
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 2);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** Drags a block's body by `dy` pixels (and `dx`). */
export async function dragBlock(page: Page, target: Locator, dx: number, dy: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("block not found");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(page, from, { x: from.x + dx, y: from.y + dy });
}

export async function openCalendar(page: Page, slug: string, view: "week" | "day" = "week") {
  await page.goto(`/w/${slug}/calendar?view=${view}`);
  await expect(calendar(page)).toBeVisible();
}
