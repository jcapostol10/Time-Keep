import "server-only";

import { randomUUID } from "node:crypto";

import {
  isUndeliverable,
  OUTBOX_BACKOFF_MINUTES,
  OUTBOX_LEASE_MINUTES,
  OUTBOX_MAX_ATTEMPTS,
} from "@timekeep/core";
import { type Database, type DbExecutor, emailOutbox, eq, sql } from "@timekeep/db";
import type { SQL } from "drizzle-orm";
import { isE2eEmail } from "@timekeep/db/e2e-tenant";

import { env } from "./env";
import { type EmailContent, renderEmail, type RenderedEmail, sendRenderedEmail } from "./mail";
import type { CaptureEnv } from "./mail-capture";

export type { RenderedEmail };

/**
 * The email outbox (Phase 5a decision 1). A cause (a submitted period, a
 * reminder) enqueues its email in its own transaction, so a rolled-back cause
 * sends nothing; nothing is sent inside a request. `drainOutbox` sends what is
 * due: after the request (`drainSoon`), from the daily cron, and locally from
 * the worker every minute.
 */

/**
 * Production and every preview share one database, and so one outbox: each
 * sends only its own mail. Production sends to real people and never to the
 * e2e and demo domains; a preview sends (captures) only those domains; a
 * local or nightly server, alone on its database, sends everything.
 */
export type OutboxAudience = "all" | "e2e" | "real";

export function outboxAudience(e: CaptureEnv): OutboxAudience {
  if (e.VERCEL_ENV === "production") return "real";
  if (e.VERCEL_ENV !== undefined) return "e2e";
  return "all";
}

function belongs(audience: OutboxAudience, address: string): boolean {
  if (audience === "all") return true;
  return isE2eEmail(address) === (audience === "e2e");
}

const E2E_ADDRESS = sql`(lower(to_address) like '%@e2e.test' or lower(to_address) like '%@demo.test')`;

function audienceSql(audience: OutboxAudience): SQL {
  if (audience === "e2e") return E2E_ADDRESS;
  if (audience === "real") return sql`not ${E2E_ADDRESS}`;
  return sql`true`;
}

export interface OutgoingMessage extends EmailContent {
  workspaceId: string | null;
  to: string;
  subject: string;
  /** What it is, e.g. "approval.submitted"; a reminder carries its period. */
  kind: string;
  /** A file in the private export bucket to attach (Phase 6d: the invoice PDF), by key and name. */
  attachment?: { key: string; name: string };
}

export async function enqueueEmail(
  db: Pick<DbExecutor, "insert">,
  msg: OutgoingMessage,
  opts: { audience?: OutboxAudience } = {},
): Promise<void> {
  const audience = opts.audience ?? outboxAudience(env());
  const { html, text } = renderEmail(msg);
  await db.insert(emailOutbox).values({
    id: randomUUID(),
    workspaceId: msg.workspaceId,
    toAddress: msg.to.trim(),
    subject: msg.subject,
    html,
    text,
    kind: msg.kind,
    attachmentKey: msg.attachment?.key ?? null,
    attachmentName: msg.attachment?.name ?? null,
    // Mail this environment must not send stays as a record, never sent by anyone.
    status: isUndeliverable(msg.to) || !belongs(audience, msg.to) ? "SKIPPED" : "PENDING",
  });
}

export async function drainOutbox(
  db: Database,
  opts: {
    limit?: number;
    now?: Date;
    send?: (msg: RenderedEmail) => Promise<unknown>;
    /** Reads an attachment's bytes by key; the private export bucket by default. */
    load?: (key: string) => Promise<Uint8Array>;
    audience?: OutboxAudience;
  } = {},
): Promise<{ sent: number; failed: number }> {
  // Times are the database's: a row is stamped with its now(), and the app
  // server's clock can be off it (a test passes an explicit `now`).
  const now = opts.now ? sql`${opts.now}::timestamptz` : sql`now()`;
  const later = (minutes: number) => sql`${now} + make_interval(mins => ${minutes})`;
  const audience = opts.audience ?? outboxAudience(env());
  const send = opts.send ?? sendRenderedEmail;
  const load = opts.load ?? ((key: string) => import("./storage").then((m) => m.getExport(key)));
  // One statement claims the due rows: SKIP LOCKED lets a concurrent drain take
  // others, and the lease moves them out of "due" so nobody claims them again
  // until it ends (a crashed sender's rows come back then).
  const claimed = await db
    .update(emailOutbox)
    .set({
      attempts: sql`${emailOutbox.attempts} + 1`,
      nextAttemptAt: later(OUTBOX_LEASE_MINUTES),
    })
    .where(
      sql`${emailOutbox.id} in (
        select id from email_outbox
        where status = 'PENDING' and next_attempt_at <= ${now} and ${audienceSql(audience)}
        order by next_attempt_at
        limit ${opts.limit ?? 50}
        for update skip locked
      )`,
    )
    .returning();

  let sent = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      const message: RenderedEmail = {
        to: row.toAddress,
        subject: row.subject,
        html: row.html,
        text: row.text,
      };
      if (row.attachmentKey) {
        message.attachments = [
          {
            filename: row.attachmentName ?? "attachment",
            content: await load(row.attachmentKey),
          },
        ];
      }
      await send(message);
      await db
        .update(emailOutbox)
        .set({ status: "SENT", sentAt: now, lastError: null })
        .where(eq(emailOutbox.id, row.id));
      sent++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      const giveUp = row.attempts >= OUTBOX_MAX_ATTEMPTS;
      const wait = OUTBOX_BACKOFF_MINUTES[row.attempts - 1] ?? 0;
      await db
        .update(emailOutbox)
        .set({
          status: giveUp ? "FAILED" : "PENDING",
          nextAttemptAt: later(wait),
          lastError: message.slice(0, 1000),
        })
        .where(eq(emailOutbox.id, row.id));
      if (giveUp) console.error(`[outbox] gave up on "${row.subject}" (${row.kind})`, error);
      else console.warn(`[outbox] send failed, retrying in ${wait} min (${row.kind}): ${message}`);
    }
  }
  return { sent, failed };
}

/** Drains batch after batch while they come back full, within a time budget. */
export async function drainAll(
  db: Database,
  opts: Parameters<typeof drainOutbox>[1] & { budgetMs?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const limit = opts.limit ?? 50;
  const deadline = Date.now() + (opts.budgetMs ?? 60_000);
  const total = { sent: 0, failed: 0 };
  for (;;) {
    const batch = await drainOutbox(db, { ...opts, limit });
    total.sent += batch.sent;
    total.failed += batch.failed;
    if (batch.sent + batch.failed < limit || Date.now() > deadline) return total;
  }
}
