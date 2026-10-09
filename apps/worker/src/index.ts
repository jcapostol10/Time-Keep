import { PgBoss } from "pg-boss";

/**
 * Background job runner. Phase 0 only proves the worker boots against Postgres
 * and processes a job; later phases register reminders, exports, invoices, webhooks.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to start the worker");
}

const boss = new PgBoss({ connectionString, schema: "pgboss" });

boss.on("error", (error) => console.error("[worker] pg-boss error", error));

const HEARTBEAT_QUEUE = "system.heartbeat";

async function main() {
  await boss.start();
  await boss.createQueue(HEARTBEAT_QUEUE);

  await boss.work(HEARTBEAT_QUEUE, async (jobs) => {
    for (const job of jobs) {
      console.info(`[worker] heartbeat ${job.id} at ${new Date().toISOString()}`);
    }
  });

  // Every 15 minutes; proves scheduling works end to end.
  await boss.schedule(HEARTBEAT_QUEUE, "*/15 * * * *");
  await boss.send(HEARTBEAT_QUEUE, {});

  console.info("[worker] started");
}

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, stopping`);
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});
