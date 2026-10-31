import { PgBoss } from "pg-boss";

/**
 * Background job runner for local development and self-hosting. Production on
 * Vercel has no long-lived process: there the email outbox drains after each
 * request and from the daily cron. Here it also drains every minute, through
 * the app's own route so the sending code lives in one place.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to start the worker");
}

const boss = new PgBoss({ connectionString, schema: "pgboss" });

boss.on("error", (error) => console.error("[worker] pg-boss error", error));

const HEARTBEAT_QUEUE = "system.heartbeat";
const OUTBOX_QUEUE = "outbox.drain";

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const cronSecret = process.env.CRON_SECRET;

async function drainOutbox() {
  const res = await fetch(`${appUrl}/api/cron/outbox`, {
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  if (!res.ok) console.warn(`[worker] outbox drain answered ${res.status}`);
}

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

  if (cronSecret) {
    await boss.createQueue(OUTBOX_QUEUE);
    await boss.work(OUTBOX_QUEUE, async () => {
      try {
        await drainOutbox();
      } catch (error) {
        // The app may still be starting; the next minute tries again.
        console.warn(
          "[worker] outbox drain failed",
          error instanceof Error ? error.message : error,
        );
      }
    });
    await boss.schedule(OUTBOX_QUEUE, "* * * * *");
  } else {
    console.info("[worker] CRON_SECRET is unset: email is sent after each request only");
  }

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
