import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI builds first and runs the production server; locally reuse `pnpm dev`.
    command: isCI ? "pnpm start" : "pnpm dev",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
