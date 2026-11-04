import { personalWorkspaceName } from "@timekeep/core";

import { expect, test } from "./fixtures";
import { overflowingElements } from "./helpers/app";
import { createProjectViaUi } from "./helpers/catalog";
import {
  createKioskViaUi,
  kioskEnterPin,
  kioskPinPunch,
  openKiosk,
  setOwnPinViaUi,
} from "./helpers/kiosk";
import { detailedRow, openReport } from "./helpers/reports";

/**
 * Kiosks (Phase 5c): a shared device that needs no login. The owner makes a
 * kiosk and a PIN; the kiosk itself runs in a context with no cookies.
 */

test.describe("kiosk", () => {
  test("a kiosk PIN punch creates a normal entry visible in the Detailed report", async ({
    page,
    freshUser,
    browser,
  }) => {
    const { slug, name } = freshUser;
    await createProjectViaUi(page, slug, "Front desk work");
    const url = await createKioskViaUi(page, slug, {
      name: "Front desk",
      project: "Front desk work",
    });
    await setOwnPinViaUi(page, personalWorkspaceName(name), "4321");

    const device = await browser.newContext();
    const kiosk = await device.newPage();
    await openKiosk(kiosk, url);
    await kioskPinPunch(kiosk, { name, pin: "4321", action: "CLOCK_IN" });
    // A punch takes the server's time; a second is enough for a non-zero entry.
    await kiosk.waitForTimeout(1_100);
    await kioskPinPunch(kiosk, { name, pin: "4321", action: "CLOCK_OUT" });
    // The kiosk never signs anyone in. Names only: a failed assertion's diff lands in the
    // public report, and on a preview the cookies include Vercel's protection bypass.
    const cookies = (await device.cookies()).map((c) => c.name);
    expect(cookies.filter((n) => !n.startsWith("_vercel") && !n.startsWith("vercel-"))).toEqual([]);
    await device.close();

    await openReport(page, slug, "detailed");
    const row = detailedRow(page, "Kiosk: Front desk");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Front desk work");
  });

  test("the kiosk screen works at 375 px", async ({ page, freshUser, browser }) => {
    const { slug, name } = freshUser;
    const url = await createKioskViaUi(page, slug, { name: "Lobby" });
    await setOwnPinViaUi(page, personalWorkspaceName(name), "1357");

    const device = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const kiosk = await device.newPage();
    await openKiosk(kiosk, url);
    expect(await overflowingElements(kiosk)).toEqual([]);
    await kioskEnterPin(kiosk, name, "1357");
    await expect(kiosk.getByRole("button", { name: "Clock in", exact: true })).toBeVisible();
    expect(await overflowingElements(kiosk)).toEqual([]);
    await device.close();
  });
});
