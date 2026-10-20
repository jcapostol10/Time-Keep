import { expect, test } from "@playwright/test";

import {
  openWorkspaceSwitcher,
  signIn,
  signUpAndVerify,
  uniqueEmail,
  workspaceSlugFromUrl,
} from "./helpers/app";
import { extractAppLink, waitForEmail } from "./helpers/mail";

test.describe("workspaces", () => {
  test("invite a second user, accept the invite and switch between workspaces", async ({
    browser,
  }) => {
    // Owner creates a fresh workspace and invites a colleague.
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const ownerEmail = uniqueEmail("owner");
    await signUpAndVerify(owner, "Owen Owner", ownerEmail);

    await owner.goto("/workspaces/new");
    await owner.getByLabel("Workspace name").fill("Owen Studio");
    await owner.getByRole("button", { name: "Create workspace" }).click();
    await expect(owner).toHaveURL(/\/w\/owen-studio(-\d+)?\/tracker/);
    const studioSlug = workspaceSlugFromUrl(owner);

    const inviteeEmail = uniqueEmail("invitee");
    await owner.goto(`/w/${studioSlug}/team`);
    await owner.getByRole("button", { name: "Invite member" }).click();
    await owner.getByLabel("Email").fill(inviteeEmail);
    await owner.getByRole("button", { name: "Send invitation" }).click();
    await expect(owner.getByText(`Invitation sent to ${inviteeEmail}`)).toBeVisible();
    await expect(owner.getByRole("cell", { name: inviteeEmail, exact: true })).toBeVisible();

    // Invitee signs up with the invited address, then opens the invite link.
    const inviteMessage = await waitForEmail(inviteeEmail, { subject: /invited you/i });
    const inviteLink = extractAppLink(inviteMessage);

    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();
    await signUpAndVerify(invitee, "Ivy Invitee", inviteeEmail);
    const personalSlug = workspaceSlugFromUrl(invitee);

    await invitee.goto(inviteLink);
    await expect(invitee.getByRole("heading", { name: "Join Owen Studio" })).toBeVisible();
    await invitee.getByRole("button", { name: "Accept invitation" }).click();
    await expect(invitee).toHaveURL(new RegExp(`/w/${studioSlug}/tracker`));

    // Switcher lists both workspaces; switching navigates and persists.
    await openWorkspaceSwitcher(invitee);
    await expect(invitee.getByRole("menuitem", { name: /Owen Studio/ })).toBeVisible();
    await invitee.getByRole("menuitem", { name: /Ivy's workspace/ }).click();
    await expect(invitee).toHaveURL(new RegExp(`/w/${personalSlug}/tracker`));

    await invitee.goto("/");
    await expect(invitee).toHaveURL(new RegExp(`/w/${personalSlug}/tracker`));

    // Owner now sees the new member and no pending invite.
    await owner.reload();
    await expect(owner.getByRole("cell", { name: /Ivy Invitee/ })).toBeVisible();
    await expect(owner.getByText("Pending invitations")).toHaveCount(0);

    await ownerContext.close();
    await inviteeContext.close();
  });

  test("members cannot invite; admins can", async ({ page }) => {
    await signIn(page, "member1@demo.test");
    await page.goto("/w/demo/team");
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
  });

  test("workspace settings are read-only for members and editable by admins", async ({ page }) => {
    await signIn(page, "member1@demo.test");
    await page.goto("/w/demo/settings");
    await expect(
      page.getByText("Only admins and the owner can change these settings."),
    ).toBeVisible();
    await expect(page.getByLabel("Workspace name")).toBeDisabled();
  });
});
