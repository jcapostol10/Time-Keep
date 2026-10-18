import { spawnSync } from "node:child_process";
import path from "node:path";

import { cleanupTarget, isLocalDatabaseUrl } from "../scripts/local-db-guard";

/**
 * Local runs only: remove the throwaway @e2e.test users the suite created.
 * Remote runs are cleaned by the e2e-preview workflow, and this never touches
 * a database that is not on this machine.
 */
export default function globalTeardown() {
  if (process.env.E2E_BASE_URL) return;
  const target = cleanupTarget(process.env);
  if (!target || !isLocalDatabaseUrl(target)) {
    console.info("[e2e teardown] the cleanup database is not local; skipping cleanup");
    return;
  }
  // A fixed command string: nothing user-controlled reaches the shell.
  spawnSync("pnpm db:e2e-cleanup", {
    // Playwright loads this file as CommonJS, so __dirname (not import.meta) is available.
    cwd: path.resolve(__dirname, "../../.."),
    stdio: "inherit",
    shell: true,
    // Pin the checked URL: dotenv in the child does not override set variables.
    env: { ...process.env, DATABASE_URL: target, DATABASE_URL_SESSION: target },
  });
}
