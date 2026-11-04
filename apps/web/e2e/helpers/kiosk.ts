import { expect, type Page } from "@playwright/test";

import type { KioskAction } from "@timekeep/core";

import { waitForApp } from "./app";
import { openSettings, saveSettings } from "./settings";
import { openTeam } from "./team";

/** The kiosk screen's buttons for each punch. */
export const ACTION_LABELS: Record<KioskAction, string> = {
  CLOCK_IN: "Clock in",
  START_BREAK: "Start break",
  END_BREAK: "End break",
  CLOCK_OUT: "Clock out",
};

/** Turns the workspace's "Allow breaks" setting on. */
export async function allowBreaks(page: Page, slug: string) {
  await openSettings(page, slug);
  const toggle = page.getByRole("switch", { name: "Allow breaks" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await saveSettings(page);
}

/** Reads the device URL from the dialog shown after create and rotate, and closes it. */
async function takeDeviceUrl(page: Page): Promise<string> {
  const dialog = page.getByRole("dialog", { name: "Device URL" });
  const url = await dialog.getByRole("textbox", { name: "Device URL" }).inputValue();
  expect(url).toMatch(/\/kiosk\/[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  return url;
}

/** Creates a kiosk on the Kiosks page and returns its device URL. */
export async function createKioskViaUi(
  page: Page,
  slug: string,
  opts: { name: string; project?: string; photo?: boolean },
): Promise<string> {
  await page.goto(`/w/${slug}/kiosks`);
  await waitForApp(page);
  await page.getByRole("button", { name: "New kiosk" }).click();
  const dialog = page.getByRole("dialog", { name: "New kiosk" });
  await dialog.getByLabel("Name").fill(opts.name);
  if (opts.project) {
    await dialog.getByRole("button", { name: /^Project:/ }).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill(opts.project);
    await page.getByRole("option", { name: opts.project, exact: true }).click();
  }
  if (opts.photo) await dialog.getByRole("switch", { name: "Take a photo at clock in" }).click();
  await dialog.getByRole("button", { name: "Create kiosk" }).click();
  await expect(dialog).toBeHidden();
  return takeDeviceUrl(page);
}

/** Rotates a kiosk's URL from its row menu and returns the new one. */
export async function rotateKioskViaUi(page: Page, slug: string, name: string): Promise<string> {
  await page.goto(`/w/${slug}/kiosks`);
  await waitForApp(page);
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Rotate URL…" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Rotate the device URL?" });
  await expect(confirm).toContainText("The old URL stops working on every device.");
  await confirm.getByRole("button", { name: "Rotate URL" }).click();
  return takeDeviceUrl(page);
}

/** Sets the signed-in person's kiosk PIN for `workspaceName` on the account page. */
export async function setOwnPinViaUi(page: Page, workspaceName: string, pin: string) {
  await page.goto("/account");
  await waitForApp(page);
  const section = page.getByRole("region", { name: "Kiosk" });
  const row = section.getByRole("listitem").filter({ hasText: workspaceName });
  await row.getByRole("button", { name: /^(Set|Change) PIN$/ }).click();
  await savePinDialog(page, pin);
}

async function savePinDialog(page: Page, pin: string) {
  const dialog = page.getByRole("dialog", { name: "Kiosk PIN" });
  await expect(dialog).toContainText(
    "Five wrong tries lock your PIN for 15 minutes. A 6-digit PIN is harder to guess.",
  );
  await dialog.getByLabel("PIN", { exact: true }).fill(pin);
  await dialog.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByText("PIN saved")).toBeVisible();
}

/** Opens a kiosk in `page` (a context with no session) and waits for its people. */
export async function openKiosk(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
  await expect(page.getByRole("list", { name: "People" })).toBeVisible();
}

/** Taps `name` and enters `pin` on the PIN pad; the person's actions are then shown. */
export async function kioskEnterPin(page: Page, name: string, pin: string) {
  await page.getByRole("list", { name: "People" }).getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: "Enter your PIN" })).toBeVisible();
  for (const digit of pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "OK", exact: true }).click();
}

/** A whole visit: name, PIN, then one punch; returns once the screen confirms it. */
export async function kioskPinPunch(
  page: Page,
  opts: { name: string; pin: string; action: KioskAction },
) {
  await kioskEnterPin(page, opts.name, opts.pin);
  await page.getByRole("button", { name: ACTION_LABELS[opts.action], exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Worked today:");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("list", { name: "People" })).toBeVisible();
}

/** Adds a limited user from the Team page. */
export async function addLimitedUserViaUi(page: Page, slug: string, name: string) {
  await openTeam(page, slug);
  await page.getByRole("button", { name: "Add limited user" }).click();
  const dialog = page.getByRole("dialog", { name: "Add limited user" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden();
}

/** Sets a limited user's PIN from their Team row menu. */
export async function setMemberPinViaUi(page: Page, slug: string, name: string, pin: string) {
  await openTeam(page, slug);
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Set PIN" }).click();
  await savePinDialog(page, pin);
}
