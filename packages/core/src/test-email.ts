/**
 * How often a person may send themselves a test email. Each one costs
 * provider quota (a free Resend account sends 100 a day), and a loop on the
 * button would exhaust it for everyone's verification, reset and invitation
 * mail.
 */
export const TEST_EMAIL_LIMIT = { perDay: 5, minSecondsBetween: 60 } as const;

export type TestEmailAllowance =
  { allowed: true; countInDay: number } | { allowed: false; reason: string };

/**
 * Whether another test email may go out now, given the last send and how
 * many went out in the day it started; the day resets 24 hours after the
 * last send.
 */
export function testEmailAllowance(args: {
  lastSentAt: Date | null;
  countInDay: number;
  now: Date;
}): TestEmailAllowance {
  const { lastSentAt, now } = args;
  if (!lastSentAt) return { allowed: true, countInDay: 1 };
  const sinceLastMs = now.getTime() - lastSentAt.getTime();
  if (sinceLastMs >= 24 * 3_600_000) return { allowed: true, countInDay: 1 };
  const minMs = TEST_EMAIL_LIMIT.minSecondsBetween * 1000;
  if (sinceLastMs < minMs) {
    const wait = Math.ceil((minMs - sinceLastMs) / 1000);
    return {
      allowed: false,
      reason: `You can send another test email in ${wait} second${wait === 1 ? "" : "s"}.`,
    };
  }
  if (args.countInDay >= TEST_EMAIL_LIMIT.perDay) {
    return {
      allowed: false,
      reason: `That is ${TEST_EMAIL_LIMIT.perDay} test emails today; try again tomorrow.`,
    };
  }
  return { allowed: true, countInDay: args.countInDay + 1 };
}
