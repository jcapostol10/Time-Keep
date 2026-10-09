/** Minimal Mailpit HTTP API client for e2e tests (https://mailpit.axllent.org/docs/api-v1/). */

const MAILPIT_URL = (process.env.MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

interface MessageSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

interface Message extends MessageSummary {
  HTML: string;
  Text: string;
}

async function search(query: string): Promise<MessageSummary[]> {
  const res = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(query)}&limit=20`,
  );
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as { messages: MessageSummary[] };
  return body.messages;
}

async function getMessage(id: string): Promise<Message> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message failed: ${res.status}`);
  return (await res.json()) as Message;
}

export async function deleteAllMessages(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

/** Poll until an email to `to` (optionally matching `subject`) arrives. */
export async function waitForEmail(
  to: string,
  options: { subject?: RegExp; timeoutMs?: number } = {},
): Promise<Message> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const matches = await search(`to:${to}`);
    const hit = matches.find((m) => !options.subject || options.subject.test(m.Subject));
    if (hit) return getMessage(hit.ID);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to}${options.subject ? ` matching ${options.subject}` : ""}`);
}

/** First link in the email that points at the app. */
export function extractAppLink(message: Message): string {
  const source = message.Text || message.HTML;
  const escaped = APP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}[^\\s"'<>]+`));
  if (!match) throw new Error(`No app link found in email "${message.Subject}"`);
  return match[0].replace(/&amp;/g, "&");
}
