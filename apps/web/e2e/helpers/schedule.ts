import { expect, type Locator, type Page } from "@playwright/test";

import { waitForApp } from "./app";
import { escapeRegExp } from "./catalog";

/** The schedule (Phase 7a): the team grid, the project schedule and My schedule. */

export type ScheduleTab = "team" | "projects" | "mine";

/** Opens a tab on the week (or zoom) starting at `from` (a date key). */
export async function openSchedule(
  page: Page,
  slug: string,
  tab: ScheduleTab,
  from?: string,
  zoom?: "week" | "2weeks" | "month",
) {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (zoom) q.set("zoom", zoom);
  await page.goto(`/w/${slug}/schedule/${tab}${q.size ? `?${q}` : ""}`);
  await waitForApp(page);
}

function keyIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Next week's Monday to Sunday in the person's zone, as date keys. */
export function nextWeekDays(tz: string, now = new Date()) {
  const today = keyIn(tz, now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, (8 - weekday) % 7 || 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [mon, tue, wed, thu, fri, sat, sun] = days as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return { mon, tue, wed, thu, fri, sat, sun, days };
}

/** A person's row on the team grid. */
export const teamRow = (page: Page, name: string) =>
  page
    .getByRole("grid", { name: "Team schedule" })
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${escapeRegExp(name)}`) }) });

/** A day cell of a row (it carries `data-heat` and its numbers in its label). */
export const dayCell = (row: Locator, dateKey: string) =>
  row.locator(`[role="gridcell"][data-day="${dateKey}"]`);

/** A bar, by the start of its name ("Website · 2:00 a day"). */
export const bar = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}`) });

export async function pickProject(page: Page, dialog: Locator, project: string) {
  await dialog.getByRole("button", { name: /^Project:/ }).click();
  await page.getByRole("combobox", { name: "Search projects" }).fill(project);
  await page.getByRole("option", { name: project, exact: true }).click();
}

/** Fills and saves the Add assignment dialog (opened with "Add assignment" unless already open). */
export async function addAssignmentViaUi(
  page: Page,
  opts: {
    person?: string;
    project: string;
    start: string;
    end: string;
    perDay?: string;
    total?: string;
    open?: boolean;
    /** Switch "Include non-working days" on (a day that may be a weekend). */
    nonWorking?: boolean;
  },
) {
  if (opts.open !== false) await page.getByRole("button", { name: "Add assignment" }).click();
  const dialog = page.getByRole("dialog", { name: "Add assignment" });
  if (opts.person) {
    await dialog.getByRole("combobox", { name: "Person" }).click();
    await page.getByRole("option", { name: opts.person, exact: true }).click();
  }
  await pickProject(page, dialog, opts.project);
  await dialog.getByLabel("Start", { exact: true }).fill(opts.start);
  await dialog.getByLabel("End", { exact: true }).fill(opts.end);
  if (opts.total) {
    await dialog.getByRole("radio", { name: "Total" }).click();
    await dialog.getByRole("textbox", { name: "Total hours" }).fill(opts.total);
  } else {
    await dialog.getByRole("textbox", { name: "Hours per day" }).fill(opts.perDay ?? "8");
  }
  if (opts.nonWorking) {
    await dialog.getByRole("switch", { name: "Include non-working days" }).click();
  }
  await dialog.getByRole("button", { name: "Save assignment" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Assignment saved").first()).toBeVisible();
}

/** The center of a locator, for mouse gestures. */
export async function center(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses at `from`, moves in steps to `to`, releases. */
export async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Today's date key in the person's zone. */
export function todayKey(tz: string, now = new Date()): string {
  return keyIn(tz, now);
}

/** Publishes the drafts from the team grid. */
export async function publishSchedule(page: Page) {
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Schedule published")).toBeVisible();
}
