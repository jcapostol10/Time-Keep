import type { Page } from "@playwright/test";

/** Locators and date helpers for the timesheet grid. */

/** YYYY-MM-DD of `date` in `tz`. */
export function dateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The column heading the grid shows for `date` in `tz`, e.g. "Mon 9". */
export function dayLabel(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
  }).format(date);
}

export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

export const grid = (page: Page) => page.getByRole("grid", { name: "Timesheet" });

/** A cell input, named "<row label> <day label>". */
export const cell = (page: Page, rowLabel: string, day: string) =>
  grid(page).getByRole("textbox", { name: `${rowLabel} ${day}`, exact: true });

export const dayTotal = (page: Page, day: string) =>
  grid(page).getByRole("gridcell", { name: `Total ${day}`, exact: true });

export const rowTotal = (page: Page, rowLabel: string) =>
  grid(page).getByRole("gridcell", { name: `Total ${rowLabel}`, exact: true });

/** Commits a cell value with Enter and waits for the save to land. */
export async function typeCell(page: Page, rowLabel: string, day: string, value: string) {
  const input = cell(page, rowLabel, day);
  await input.fill(value);
  await input.press("Enter");
}
