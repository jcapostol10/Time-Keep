import "server-only";

import { APIError } from "better-auth/api";
import nodemailer, { type Transporter } from "nodemailer";

import { getDb } from "@timekeep/db";

import { env } from "./env";
import { captureEmail, previewMailMode } from "./mail-capture";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    const e = env();
    transporter = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS ?? "" } : undefined,
    });
  }
  return transporter;
}

export interface EmailContent {
  /** Headline inside the email body. */
  title: string;
  /** One or two short sentences. */
  intro: string;
  cta?: { label: string; url: string };
  outro?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Minimal, dependency-free HTML template. Readable in every client, Mailpit included. */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const cta = content.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(content.cta.url)}" style="display:inline-block;background:#1f8a8a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escapeHtml(content.cta.label)}</a></p>
       <p style="font-size:13px;color:#667">If the button does not work, open this link:<br><a href="${escapeHtml(content.cta.url)}" style="color:#1f8a8a">${escapeHtml(content.cta.url)}</a></p>`
    : "";
  const outro = content.outro
    ? `<p style="font-size:13px;color:#667">${escapeHtml(content.outro)}</p>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c2430">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:32px;border:1px solid #e3e8ec">
    <p style="margin:0 0 16px;font-weight:700;letter-spacing:.02em;color:#1f8a8a">TimeKeep</p>
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(content.title)}</h1>
    <p style="font-size:15px;line-height:1.5;margin:0">${escapeHtml(content.intro)}</p>
    ${cta}
    ${outro}
  </div>
</body></html>`;

  const text = [
    content.title,
    "",
    content.intro,
    content.cta ? `\n${content.cta.label}: ${content.cta.url}` : "",
    content.outro ? `\n${content.outro}` : "",
  ]
    .join("\n")
    .trim();

  return { html, text };
}

export async function sendEmail(args: { to: string; subject: string } & EmailContent) {
  const { html, text } = renderEmail(args);
  const mode = previewMailMode(env(), args.to);
  if (mode === "capture") {
    // Preview deployments: store e2e mail instead of sending; e2e reads /api/test/emails.
    await captureEmail(getDb(), { to: args.to, subject: args.subject, html, text });
    return;
  }
  if (mode === "drop") {
    console.warn(`[mail] preview: dropped "${args.subject}" to a non-e2e recipient`);
    return;
  }
  await getTransporter().sendMail({
    from: env().MAIL_FROM,
    to: args.to,
    subject: args.subject,
    html,
    text,
  });
}

/**
 * For the auth hooks: a transport failure (an unverified sender, a refused
 * recipient) becomes a message the person can act on, with the cause logged
 * on the server, instead of a bare 500 whose text they would never see.
 */
export async function sendEmailOrExplain(
  what: string,
  args: Parameters<typeof sendEmail>[0],
  send: (args: Parameters<typeof sendEmail>[0]) => Promise<void> = sendEmail,
): Promise<void> {
  try {
    await send(args);
  } catch (error) {
    console.error(`[mail] could not send the ${what}`, error);
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message: `We couldn't send the ${what}. Try again in a minute, or contact support.`,
      code: "EMAIL_SEND_FAILED",
    });
  }
}
