/**
 * Vercel build entry point (Vercel runs `vercel-build` instead of `build`).
 *
 * Production deployments apply database migrations first. Preview deployments
 * share the production database, so they never migrate: a half-finished
 * branch must not change the live schema.
 */
import { spawnSync } from "node:child_process";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const env = process.env.VERCEL_ENV ?? "development";

if (env === "production") {
  console.info("[vercel-build] production: applying migrations");
  run("pnpm", ["--filter", "@timekeep/db", "db:migrate"]);
} else {
  console.info(`[vercel-build] ${env}: skipping migrations (previews never migrate)`);
}

run("pnpm", ["exec", "next", "build"]);
