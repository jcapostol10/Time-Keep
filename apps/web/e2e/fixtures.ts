import { test as base, expect, type Page } from "@playwright/test";

import { DEMO_PASSWORD, uniqueEmail } from "./helpers/app";
import { extractAppLink, waitForEmail } from "./helpers/mail";

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
    const name = "Fresh Tester";
    const email = uniqueEmail("fresh");
    const password = DEMO_PASSWORD;
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;

    const signUp = await page.request.post("/api/auth/sign-up/email", {
      data: { name, email, password, timezone: "Asia/Manila" },
      headers: { origin },
    });
    expect(signUp.ok(), `sign-up for ${email} returned ${signUp.status()}`).toBe(true);

    let link: string;
    try {
      link = extractAppLink(await waitForEmail(email, { subject: /verify/i }));
    } catch {
      throw new Error(`freshUser: no verification email for ${email}`);
    }
    const verified = await page.request.get(link);
    expect(verified.ok(), `verification for ${email} returned ${verified.status()}`).toBe(true);

    const home = await page.request.get("/", { maxRedirects: 0 });
    const slug = /\/w\/([^/]+)\//.exec(home.headers()["location"] ?? "")?.[1];
    if (!slug) throw new Error(`freshUser: ${email} is not signed in after verification`);

    session.slug = slug;
    await provide({ email, password, name, slug });
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
