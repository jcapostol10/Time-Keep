/**
 * Senders that only work before a domain is verified in Resend. No
 * `server-only` here: the build script checks the same rule.
 */
export const PLACEHOLDER_SENDER = /@(timekeep\.local|resend\.dev)\b/i;

/**
 * Why production mail cannot go out with this configuration, or null. Checked
 * where mail is sent, not where the environment is parsed: a bad sender must
 * fail the sends (and say why), never every request of the app.
 */
export function mailSenderProblem(e: { VERCEL_ENV?: string; MAIL_FROM: string }): string | null {
  if (e.VERCEL_ENV !== "production") return null;
  if (!PLACEHOLDER_SENDER.test(e.MAIL_FROM)) return null;
  return "MAIL_FROM is a placeholder sender; production mail needs a verified domain (docs/BACKLOG.md, production email).";
}
