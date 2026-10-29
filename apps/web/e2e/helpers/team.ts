import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { type FreshUser, signUpFreshUser } from "../fixtures";
import { waitForApp } from "./app";
import { extractAppLink, waitForEmail } from "./mail";

export type InviteRole = "Admin" | "Manager" | "Member";

/** Opens the Team page and waits for it to be interactive. */
export async function openTeam(page: Page, slug: string, query = "") {
  await page.goto(`/w/${slug}/team${query ? `?${query}` : ""}`);
  await waitForApp(page);
}

/** Invites `emails` (one per line) from the Team page with one role and optional groups; returns the dialog. */
export async function inviteViaUi(
  page: Page,
  slug: string,
  emails: string[],
  role: InviteRole,
  groups: string[] = [],
) {
  await openTeam(page, slug);
  await page.getByRole("button", { name: "Invite members" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite members" });
  await dialog.getByLabel("Email addresses").fill(emails.join("\n"));
  await dialog.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: role, exact: true }).click();
  for (const group of groups) await dialog.getByRole("checkbox", { name: group }).check();
  await dialog.getByRole("button", { name: "Send invitations" }).click();
  await expect(dialog.getByRole("list", { name: "Invitation results" })).toBeVisible();
  return dialog;
}

export interface Teammate {
  user: FreshUser;
  context: BrowserContext;
  page: Page;
}

/**
 * A second person in the owner's workspace: a fresh account (named `name`) the
 * owner invites from the Team page, who accepts through the email's link.
 */
export async function addTeammate(
  owner: Page,
  browser: Browser,
  baseURL: string | undefined,
  slug: string,
  name: string,
  role: InviteRole,
  groups: string[] = [],
): Promise<Teammate> {
  const context = await browser.newContext();
  const user = await signUpFreshUser(context.request, baseURL, name);
  const dialog = await inviteViaUi(owner, slug, [user.email], role, groups);
  await expect(dialog.getByRole("listitem").filter({ hasText: user.email })).toContainText(
    "Invited",
  );
  await dialog.getByRole("button", { name: "Done" }).click();
  const link = extractAppLink(await waitForEmail(user.email, { subject: /invited you/i }));
  const page = await context.newPage();
  await page.goto(link);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/tracker`));
  return { user, context, page };
}

/** The Members table row for `name`. */
export const memberRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });

/** Opens a member's row menu and picks `item`. */
export async function memberAction(page: Page, name: string, item: string) {
  await memberRow(page, name)
    .getByRole("button", { name: `Actions for ${name}` })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}
