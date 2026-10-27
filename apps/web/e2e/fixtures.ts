import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";

import { DEMO_PASSWORD, uniqueEmail } from "./helpers/app";
import { extractAppLink, waitForEmail } from "./helpers/mail";
import { zoneNearNoon } from "./helpers/time-zones";

/**
 * Shared fixtures. Import `test` and `expect` from here, not from
 * @playwright/test. Sign-up and sign-in go over HTTP (the browser context's
 * request client shares cookies with the page), so a test starts signed in.
 * Works locally (Mailpit) and against a Vercel preview (captured email).
 * The fixture callback is named `provide` (Playwright calls it `use`) so the
 * React hooks lint rule does not mistake it for React's `use`.
 */
export type DemoRole = "owner" | "admin" | "manager" | "member1" | "member2";

export interface FreshUser {
  email: string;
  password: string;
  name: string;
  slug: string;
  /** The IANA zone the account was created with (local noon at sign-up). */
  timezone: string;
}

/**
 * Signs up a new @e2e.test account over `request` and verifies its email;
 * `request` then holds the session. Its time zone is one where it is about
 * noon, so a test never runs across local midnight.
 */
export async function signUpFreshUser(
  request: APIRequestContext,
  baseURL: string | undefined,
  name = "Fresh Tester",
): Promise<FreshUser> {
  const email = uniqueEmail("fresh");
  const password = DEMO_PASSWORD;
  const timezone = zoneNearNoon();
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;

  const signUp = await request.post("/api/auth/sign-up/email", {
    data: { name, email, password, timezone },
    headers: { origin },
  });
  expect(signUp.ok(), `sign-up for ${email} returned ${signUp.status()}`).toBe(true);

  let link: string;
  try {
    link = extractAppLink(await waitForEmail(email, { subject: /verify/i }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`freshUser: no verification email for ${email}: ${reason}`, { cause: error });
  }
  const verified = await request.get(link);
  expect(verified.ok(), `verification for ${email} returned ${verified.status()}`).toBe(true);

  // The new account owns exactly one workspace: its personal one.
  const list = await request.get("/api/auth/organization/list");
  expect(list.ok(), `listing workspaces for ${email} returned ${list.status()}`).toBe(true);
  const workspaces = (await list.json()) as { slug: string }[];
  const slug = workspaces.length === 1 ? workspaces[0]?.slug : undefined;
  if (!slug) {
    throw new Error(`freshUser: expected one workspace for ${email}, got ${workspaces.length}`);
  }
  return { email, password, name, slug, timezone };
}

interface Fixtures {
  /** A new @e2e.test account with its own workspace; the page is signed in. */
  freshUser: FreshUser;
  /** Signs the page in as one of the seeded demo accounts. */
  demoUser: (who: DemoRole) => Promise<void>;
  /** Opens the tracker (default: the fresh user's workspace) once it is interactive. */
  trackerPage: (slug?: string) => Promise<Page>;
  /** Per-test state shared between fixtures. */
  session: { slug?: string };
}

export const test = base.extend<Fixtures>({
  session: async ({}, provide) => {
    await provide({});
  },

  freshUser: async ({ page, baseURL, session }, provide) => {
    const user = await signUpFreshUser(page.request, baseURL);
    session.slug = user.slug;
    await provide(user);
  },

  demoUser: async ({ page, baseURL }, provide) => {
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    await provide(async (who) => {
      const res = await page.request.post("/api/auth/sign-in/email", {
        data: { email: `${who}@demo.test`, password: DEMO_PASSWORD },
        headers: { origin },
      });
      expect(res.ok(), `sign-in as ${who}@demo.test returned ${res.status()}`).toBe(true);
    });
  },

  trackerPage: async ({ page, session }, provide) => {
    await provide(async (slug) => {
      const target = slug ?? session.slug;
      if (!target) throw new Error("trackerPage: no workspace slug (use freshUser or pass one)");
      await page.goto(`/w/${target}/tracker`);
      await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
      return page;
    });
  },
});

export { expect };
