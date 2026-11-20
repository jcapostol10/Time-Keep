import { defineConfig, devices } from "@playwright/test";

import { LOCAL_E2E_SECRET } from "./e2e/helpers/approvals";

/**
 * The visual snapshots (`pnpm e2e:visual`): full-page screenshots of the main
 * screens, for people to compare before and after a UI change. They assert
 * nothing about pixels and never run with the e2e suite (its config ignores
 * `e2e/visual`). Local only: they sign in as the seeded demo owner.
 *
 *   VISUAL_SET=before pnpm e2e:visual     (default: after)
 */
const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e/visual",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: [["list"]],
  use: { baseURL, trace: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      E2E_SECRET: process.env.E2E_SECRET ?? LOCAL_E2E_SECRET,
    } as Record<string, string>,
  },
});
