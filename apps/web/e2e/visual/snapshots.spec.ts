import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

/**
 * Full-page screenshots of the main screens, as the demo owner on the seeded
 * demo workspace, at a desktop and a phone width, in light and dark. Saved to
 * `__screenshots__/<VISUAL_SET>/<screen>-<width>-<scheme>.jpg` (JPEG at
 * quality 85: the repo is public and these stay in its history).
 *
 * Nothing here compares pixels: the files are for people to look at, before
 * and after a change to the look of the app.
 */

const SET = process.env.VISUAL_SET === "before" ? "before" : "after";
const OUT = path.join(__dirname, "__screenshots__", SET);
const SLUG = "demo";
const OWNER = { email: "owner@demo.test", password: "password123" };
const TIMER_TEXT = "Visual snapshot timer";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
] as const;
const SCHEMES = ["light", "dark"] as const;

/** The signed-in screens: a name for the file and where it lives. */
const SCREENS: { name: string; path: string }[] = [
  { name: "tracker-idle", path: `/w/${SLUG}/tracker` },
  { name: "timesheet", path: `/w/${SLUG}/timesheet` },
  { name: "calendar-week", path: `/w/${SLUG}/calendar` },
  { name: "dashboard-me", path: `/w/${SLUG}/dashboard` },
  { name: "dashboard-team", path: `/w/${SLUG}/dashboard?tab=team` },
  { name: "reports-summary", path: `/w/${SLUG}/reports/summary` },
  { name: "reports-detailed", path: `/w/${SLUG}/reports/detailed` },
  { name: "projects", path: `/w/${SLUG}/projects` },
  { name: "team", path: `/w/${SLUG}/team` },
  { name: "settings", path: `/w/${SLUG}/settings` },
  { name: "approvals", path: `/w/${SLUG}/approvals` },
  { name: "invoices", path: `/w/${SLUG}/invoices` },
];

async function settle(page: Page) {
  await expect(page.locator('main[data-hydrated="true"]')).toBeVisible({ timeout: 90_000 });
  await page.waitForLoadState("networkidle");
  // Charts and skeletons: let the last frame land.
  await page.waitForTimeout(400);
}

async function shoot(page: Page, name: string, width: number, scheme: string) {
  await page.screenshot({
    path: path.join(OUT, `${name}-${width}-${scheme}.jpg`),
    type: "jpeg",
    quality: 85,
    fullPage: true,
  });
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The dev server compiles the tracker on its first visit.
  await expect(page).toHaveURL(/\/w\/[^/]+\/tracker/, { timeout: 90_000 });
}

const timer = (page: Page) => page.locator('section[aria-label="Timer"]');

const saved = (page: Page) => expect(page.locator('[data-saving="false"]')).toHaveCount(1);

/** Stops the snapshot's timer and deletes its entry: the demo tenant is left as it was. */
async function removeTimerEntry(page: Page) {
  // At desktop width whatever the snapshot's: the row's menu is laid out for it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/w/${SLUG}/tracker`);
  await settle(page);
  const row = page.getByRole("group", { name: `Entry ${TIMER_TEXT}`, exact: true });
  const stop = timer(page).getByRole("button", { name: "Stop" });
  if (await stop.isVisible()) {
    await stop.click();
    // The stopped timer becomes a row; only then is there something to delete.
    await expect(row).toBeVisible();
    await saved(page);
  }
  for (let left = await row.count(); left > 0; left = await row.count()) {
    await row.first().getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(row).toHaveCount(left - 1);
    await saved(page);
  }
  // Nothing of the snapshot may stay behind in the demo tenant: read it back.
  await page.reload();
  await settle(page);
  await expect(page.getByText(TIMER_TEXT, { exact: true })).toHaveCount(0);
}

test("screenshots of the main screens", async ({ browser }) => {
  for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({ viewport, colorScheme: scheme });
      // The dev server's own badge is not part of the app.
      await context.addInitScript(() => {
        const hide = () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal { display: none !important; }";
          document.head.append(style);
        };
        if (document.head) hide();
        else document.addEventListener("DOMContentLoaded", hide);
      });
      const page = await context.newPage();

      // The sign-in page, signed out.
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await shoot(page, "sign-in", viewport.width, scheme);

      await signIn(page);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await settle(page);
        await shoot(page, screen.name, viewport.width, scheme);
      }

      // A project's page: the first one in the list.
      await page.goto(`/w/${SLUG}/projects`);
      await settle(page);
      await page.getByRole("table").getByRole("link").first().click();
      await expect(page).toHaveURL(new RegExp(`/w/${SLUG}/projects/[^/]+`));
      await settle(page);
      await shoot(page, "project-detail", viewport.width, scheme);

      // The tracker with a timer running; the timer and its entry are removed after.
      try {
        await page.goto(`/w/${SLUG}/tracker`);
        await settle(page);
        await timer(page).getByRole("combobox", { name: "Description" }).fill(TIMER_TEXT);
        await timer(page).getByRole("button", { name: "Start" }).click();
        await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
        await page.waitForTimeout(1_200);
        await shoot(page, "tracker-running", viewport.width, scheme);
      } finally {
        await removeTimerEntry(page);
      }
      await context.close();
    }
  }
});
