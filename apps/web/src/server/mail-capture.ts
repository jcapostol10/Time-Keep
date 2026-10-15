import { randomUUID, timingSafeEqual } from "node:crypto";

import { capturedEmail, type Database, desc, eq } from "@timekeep/db";
import { isE2eEmail } from "@timekeep/db/e2e-tenant";

/**
 * Preview-only email capture. On Vercel previews (MAIL_CAPTURE=true) outgoing
 * email is stored instead of sent, and the e2e suite reads it back through
 * `/api/test/emails`. Never active in production, whatever the flag says.
 */

export interface CaptureEnv {
  MAIL_CAPTURE?: boolean;
  VERCEL_ENV?: string;
  E2E_SECRET?: string;
}

const MIN_SECRET_LENGTH = 16;
const MAX_RESULTS = 20;

export function captureEnabled(e: CaptureEnv): boolean {
  return Boolean(e.MAIL_CAPTURE) && e.VERCEL_ENV !== "production";
}

/**
 * What `sendEmail` does with a message: send it (capture off), capture it
 * (an e2e recipient on a capturing preview), or drop it (anyone else on a
 * capturing preview). Previews share the production database, so their
 * magic-link and reset tokens work in production: only mail for e2e
 * addresses may ever be stored or served.
 */
export function previewMailMode(e: CaptureEnv, to: string): "send" | "capture" | "drop" {
  if (!captureEnabled(e)) return "send";
  return isE2eEmail(to) ? "capture" : "drop";
}

/** True only on a capturing, non-production deployment with a matching secret. */
export function testEndpointAuthorized(e: CaptureEnv, provided: string | null): boolean {
  if (!captureEnabled(e)) return false;
  const secret = e.E2E_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH || !provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function captureEmail(db: Database, msg: OutgoingEmail): Promise<void> {
  await db.insert(capturedEmail).values({
    id: randomUUID(),
    toAddress: msg.to.trim().toLowerCase(),
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

export interface CapturedMessage extends OutgoingEmail {
  id: string;
  createdAt: string;
}

/** A recipient's captured messages, newest first; `subject` is a case-insensitive regex. */
export async function listCapturedEmails(
  db: Database,
  query: { to: string; subject?: string },
): Promise<CapturedMessage[]> {
  const rows = await db
    .select()
    .from(capturedEmail)
    .where(eq(capturedEmail.toAddress, query.to.trim().toLowerCase()))
    .orderBy(desc(capturedEmail.createdAt))
    .limit(MAX_RESULTS);
  let pattern: RegExp | null = null;
  if (query.subject) {
    try {
      pattern = new RegExp(query.subject, "i");
    } catch {
      pattern = null;
    }
  }
  return rows
    .filter((r) => !pattern || pattern.test(r.subject))
    .map((r) => ({
      id: r.id,
      to: r.toAddress,
      subject: r.subject,
      html: r.html,
      text: r.text,
      createdAt: r.createdAt.toISOString(),
    }));
}
