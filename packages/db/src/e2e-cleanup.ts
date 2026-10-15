import { createDb } from "./client";
import { cleanupE2eData } from "./e2e-tenant";

/** CLI: remove throwaway e2e data after a remote e2e run (`pnpm db:e2e-cleanup`). */
const url = process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_SESSION or DATABASE_URL is required");
  process.exit(1);
}
const handle = createDb(url, { max: 2 });
cleanupE2eData(handle.db)
  .then((r) =>
    console.info(
      `[e2e-cleanup] removed ${r.users} users, ${r.workspaces} workspaces, ${r.emails} captured emails; skipped ${r.skipped} users who belong to customer workspaces`,
    ),
  )
  .catch((error) => {
    console.error("[e2e-cleanup] failed", error);
    process.exitCode = 1;
  })
  .finally(() => handle.close());
