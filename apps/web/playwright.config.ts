import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

/**
 * Two modes:
 * - Local (default): runs against `pnpm dev` (or `pnpm start` in CI) with the
 *   Docker services; emails are read from Mailpit.
 * - Remote: set E2E_BASE_URL to a Vercel preview deployment. No local server is
 *   started; Vercel deployment protection is passed with the automation bypass
 *   secret, and emails are read from the preview's capture endpoint.
 */
const remoteUrl = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = remoteUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: remoteUrl ? 2 : isCI ? 1 : 0,
  timeout: remoteUrl ? 120_000 : 60_000,
  expect: { timeout: remoteUrl ? 20_000 : 10_000 },
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    // Remote traces would record the Vercel bypass header and auth cookies, and
    // reports are downloadable from this public repo, so never trace remotely.
    trace: remoteUrl ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    ...(remoteUrl && bypass
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": bypass,
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Local runs delete the @e2e.test users they created; previews are cleaned by CI.
  ...(remoteUrl ? {} : { globalTeardown: "./e2e/global-teardown.ts" }),
  ...(remoteUrl
    ? {}
    : {
        webServer: {
          // CI builds first and runs the production server; locally reuse `pnpm dev`.
          command: isCI ? "pnpm start" : "pnpm dev",
          url: baseURL,
          reuseExistingServer: !isCI,
          timeout: 180_000,
          stdout: "ignore" as const,
          stderr: "pipe" as const,
        },
      }),
});
