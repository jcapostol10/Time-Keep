import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";
import { personalWorkspaceName } from "@timekeep/core";

import { expect, test } from "./fixtures";
import { signIn, uniqueEmail, waitForApp } from "./helpers/app";
import { createProjectViaUi } from "./helpers/catalog";
import {
  addLimitedUserViaUi,
  allowBreaks,
  createKioskViaUi,
  kioskEnterPin,
  kioskPinPunch,
  openKiosk,
  rotateKioskViaUi,
  setMemberPinViaUi,
  setOwnPinViaUi,
} from "./helpers/kiosk";
import { extractAppLink, waitForEmail } from "./helpers/mail";
import { qrVideoFile } from "./helpers/qr-video";
import { detailedRow, openReport } from "./helpers/reports";
import { memberAction, memberRow, openTeam } from "./helpers/team";

/**
 * Kiosk extras (Phase 5c, nightly): breaks, the PIN lockout, QR codes through
 * a fake camera, limited users and their conversion, rotating the device URL
 * and clock-in photos. Every kiosk runs in a context with no session.
 */

test.describe("kiosk extras", { tag: "@nightly" }, () => {
  test("clock in, break and clock out on a kiosk", async ({ page, freshUser, browser }) => {
    const { slug, name } = freshUser;
    await allowBreaks(page, slug);
    const url = await createKioskViaUi(page, slug, { name: "Front desk" });
    await setOwnPinViaUi(page, personalWorkspaceName(name), "2468");

    const device = await browser.newContext();
    const kiosk = await device.newPage();
    await openKiosk(kiosk, url);
    await kioskPinPunch(kiosk, { name, pin: "2468", action: "CLOCK_IN" });
    await kiosk.waitForTimeout(1_100);
    await kioskEnterPin(kiosk, name, "2468");
    await expect(kiosk.getByRole("button", { name: "Start break", exact: true })).toBeVisible();
    await expect(kiosk.getByRole("button", { name: "Clock out", exact: true })).toBeVisible();
    await kiosk.getByRole("button", { name: "Start break", exact: true }).click();
    await expect(kiosk.getByRole("status")).toContainText("Worked today:");
    await kiosk.getByRole("button", { name: "Done" }).click();
    await kiosk.waitForTimeout(1_100);
    await kioskPinPunch(kiosk, { name, pin: "2468", action: "END_BREAK" });
    await kiosk.waitForTimeout(1_100);
    await kioskPinPunch(kiosk, { name, pin: "2468", action: "CLOCK_OUT" });
    await kioskEnterPin(kiosk, name, "2468");
    await expect(kiosk.getByRole("button", { name: "Clock in", exact: true })).toBeVisible();
    await device.close();

    await openReport(page, slug, "detailed");
    await expect(detailedRow(page, "Kiosk: Front desk")).toHaveCount(2);
  });

  test("five wrong PINs lock the person for 15 minutes", async ({ page, freshUser, browser }) => {
    const { slug, name } = freshUser;
    const url = await createKioskViaUi(page, slug, { name: "Front desk" });
    await setOwnPinViaUi(page, personalWorkspaceName(name), "8642");

    const device = await browser.newContext();
    const kiosk = await device.newPage();
    await openKiosk(kiosk, url);
    for (let i = 0; i < 5; i++) {
      await kioskEnterPin(kiosk, name, "1111");
      await expect(kiosk.getByRole("main").getByRole("alert")).toHaveText("Wrong PIN.");
      await kiosk.getByRole("button", { name: "Back" }).click();
    }
    await kioskEnterPin(kiosk, name, "8642");
    await expect(kiosk.getByRole("main").getByRole("alert")).toHaveText(
      "Too many wrong PINs. Try again in 15 minutes.",
    );
    await expect(kiosk.getByRole("button", { name: "Clock in", exact: true })).toHaveCount(0);
    await device.close();
  });

  test("a QR code punch through the camera", async ({ page, freshUser }) => {
    const { slug, name } = freshUser;
    const url = await createKioskViaUi(page, slug, { name: "Front desk" });
    await page.goto("/account");
    await waitForApp(page);
    const row = page
      .getByRole("region", { name: "Kiosk" })
      .getByRole("listitem")
      .filter({ hasText: personalWorkspaceName(name) });
    await row.getByRole("button", { name: "Show QR code" }).click();
    const dialog = page.getByRole("dialog", { name: "QR code" });
    const code = dialog.getByRole("img", { name: "Your kiosk QR code" });
    await expect(code).toBeVisible();
    const payload = await code.getAttribute("data-payload");
    expect(payload).toMatch(/^tkq1\./);

    const dir = mkdtempSync(path.join(tmpdir(), "kiosk-qr-"));
    const camera = await chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${await qrVideoFile(payload ?? "", dir)}`,
      ],
    });
    try {
      const kiosk = await (await camera.newContext()).newPage();
      await openKiosk(kiosk, url);
      await kiosk.getByRole("button", { name: "Scan QR code" }).click();
      await expect(kiosk.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
      await kiosk.getByRole("button", { name: "Clock in", exact: true }).click();
      await expect(kiosk.getByRole("status")).toContainText("Worked today:");
    } finally {
      await camera.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a limited user punches on a kiosk and shows on the Team page", async ({
    page,
    freshUser,
    browser,
  }) => {
    const { slug } = freshUser;
    const url = await createKioskViaUi(page, slug, { name: "Front desk" });
    await addLimitedUserViaUi(page, slug, "Kim Kiosk");
    await expect(memberRow(page, "Kim Kiosk")).toContainText("Kiosk only");
    await setMemberPinViaUi(page, slug, "Kim Kiosk", "9753");

    const device = await browser.newContext();
    const kiosk = await device.newPage();
    await openKiosk(kiosk, url);
    await kioskPinPunch(kiosk, { name: "Kim Kiosk", pin: "9753", action: "CLOCK_IN" });
    await kiosk.waitForTimeout(1_100);
    await kioskPinPunch(kiosk, { name: "Kim Kiosk", pin: "9753", action: "CLOCK_OUT" });
    await device.close();

    await openTeam(page, slug);
    await expect(memberRow(page, "Kim Kiosk")).toContainText("Kiosk only");
    await openReport(page, slug, "detailed");
    await expect(detailedRow(page, "Kiosk: Front desk")).toContainText("Kim Kiosk");
  });

  test("a limited user is converted to a member and sets a password", async ({
    page,
    freshUser,
    browser,
  }) => {
    const { slug } = freshUser;
    await addLimitedUserViaUi(page, slug, "Kim Kiosk");
    const email = uniqueEmail("kim");
    await memberAction(page, "Kim Kiosk", "Convert to member");
    const dialog = page.getByRole("dialog", { name: "Convert to member" });
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Convert" }).click();
    await expect(dialog).toBeHidden();
    await expect(memberRow(page, "Kim Kiosk")).toContainText(email);
    await expect(memberRow(page, "Kim Kiosk")).not.toContainText("Kiosk only");

    const message = await waitForEmail(email, { subject: /reset/i });
    const context = await browser.newContext();
    const kim = await context.newPage();
    await kim.goto(extractAppLink(message));
    await kim.getByLabel("New password").fill("kimpassword1");
    await kim.getByLabel("Confirm password").fill("kimpassword1");
    await kim.getByRole("button", { name: "Update password" }).click();
    await expect(kim).toHaveURL(/\/sign-in/);
    await signIn(kim, email, "kimpassword1");
    await expect(kim).toHaveURL(new RegExp(`/w/${slug}/`));
    await context.close();
  });

  test("rotating a kiosk retires the old device URL", async ({ page, freshUser, browser }) => {
    const { slug } = freshUser;
    const oldUrl = await createKioskViaUi(page, slug, { name: "Front desk" });
    const device = await browser.newContext();
    const kiosk = await device.newPage();
    await openKiosk(kiosk, oldUrl);

    const newUrl = await rotateKioskViaUi(page, slug, "Front desk");
    expect(newUrl).not.toBe(oldUrl);
    await kiosk.goto(oldUrl);
    await expect(kiosk.getByText("This kiosk is not available.")).toBeVisible();
    await openKiosk(kiosk, newUrl);
    await device.close();
  });

  test("a clock-in photo is visible to admins in the Detailed report", async ({
    page,
    freshUser,
  }) => {
    const { slug, name } = freshUser;
    await createProjectViaUi(page, slug, "Shop floor");
    const url = await createKioskViaUi(page, slug, {
      name: "Front desk",
      project: "Shop floor",
      photo: true,
    });
    await setOwnPinViaUi(page, personalWorkspaceName(name), "1470");

    const camera = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const kiosk = await (await camera.newContext()).newPage();
      await openKiosk(kiosk, url);
      await kioskEnterPin(kiosk, name, "1470");
      await expect(kiosk.getByText("This kiosk takes a photo when you clock in.")).toBeVisible();
      await kiosk.getByRole("button", { name: "Clock in", exact: true }).click();
      await expect(kiosk.getByRole("status")).toContainText("Worked today:");
      await kiosk.waitForTimeout(1_100);
      await kiosk.getByRole("button", { name: "Done" }).click();
      await kioskPinPunch(kiosk, { name, pin: "1470", action: "CLOCK_OUT" });
    } finally {
      await camera.close();
    }

    await openReport(page, slug, "detailed");
    const photo = detailedRow(page, "Kiosk: Front desk").getByRole("link", {
      name: "Clock-in photo",
    });
    await expect(photo).toBeVisible();
    const res = await page.request.get((await photo.getAttribute("href")) ?? "");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/jpeg");
  });
});
