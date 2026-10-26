/**
 * Read the emails the app sends, for e2e tests.
 *
 * - Locally (no E2E_BASE_URL): the Mailpit HTTP API
 *   (https://mailpit.axllent.org/docs/api-v1/).
 * - Against a Vercel preview (E2E_BASE_URL set): the preview-only
 *   `/api/test/emails` endpoint, where MAIL_CAPTURE stores outgoing email.
 */

const MAILPIT_URL = (process.env.MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");
const REMOTE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const APP_URL = (REMOTE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export interface Message {
  Subject: string;
  Text: string;
  HTML: string;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

async function mailpitSearch(to: string): Promise<MailpitSummary[]> {
  const res = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`,
  );
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as { messages: MailpitSummary[] };
  return body.messages;
}

async function mailpitMessage(id: string): Promise<Message> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message failed: ${res.status}`);
  return (await res.json()) as Message;
}

async function capturedMessages(to: string, subject?: RegExp): Promise<Message[]> {
  const params = new URLSearchParams({ to });
  if (subject) params.set("subject", subject.source);
  const res = await fetch(`${REMOTE_URL}/api/test/emails?${params}`, {
    headers: {
      "x-e2e-secret": process.env.E2E_SECRET ?? "",
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "",
    },
  });
  if (!res.ok) throw new Error(`Captured email lookup failed: ${res.status}`);
  const body = (await res.json()) as {
    messages: { subject: string; text: string; html: string }[];
  };
  return body.messages.map((m) => ({ Subject: m.subject, Text: m.text, HTML: m.html }));
}

/**
 * Deletes the mail sent to one address. Never all of Mailpit: other workers
 * are waiting for their own verification emails.
 */
export async function deleteMessagesTo(to: string): Promise<void> {
  if (REMOTE_URL) return; // captured email is pruned by `pnpm db:e2e-cleanup`
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Mailpit delete failed: ${res.status}`);
}

/** Poll until an email to `to` (optionally matching `subject`) arrives; newest wins. */
export async function waitForEmail(
  to: string,
  options: { subject?: RegExp; timeoutMs?: number } = {},
): Promise<Message> {
  const deadline = Date.now() + (options.timeoutMs ?? (REMOTE_URL ? 30_000 : 15_000));
  while (Date.now() < deadline) {
    if (REMOTE_URL) {
      const [hit] = await capturedMessages(to, options.subject);
      if (hit) return hit;
    } else {
      const matches = await mailpitSearch(to);
      const hit = matches.find((m) => !options.subject || options.subject.test(m.Subject));
      if (hit) return mailpitMessage(hit.ID);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to}${options.subject ? ` matching ${options.subject}` : ""}`);
}

/** First link in the email that points at the app under test. */
export function extractAppLink(message: Message): string {
  const source = message.Text || message.HTML;
  const escaped = APP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}[^\\s"'<>]+`));
  if (!match) throw new Error(`No app link found in email "${message.Subject}"`);
  return match[0].replace(/&amp;/g, "&");
}
