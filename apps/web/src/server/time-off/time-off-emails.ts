import { formatCenti, formatTimeOffDates, type TimeOffUnit } from "@timekeep/core";

import type { EmailContent } from "../mail";

/** The emails of Phase 5b's time off; each links to the Time off page. */

type Email = { subject: string } & EmailContent;

interface Base {
  appUrl: string;
  slug: string;
  workspaceName: string;
  policyName: string;
  start: string;
  end: string;
  amountCenti: number;
  unit: TimeOffUnit;
}

// Requests (the default tab) lists both the viewer's own time off and what they review.
const timeOffUrl = (b: Base) => `${b.appUrl}/w/${b.slug}/time-off`;
const when = (b: Base) => formatTimeOffDates(b.start, b.end);
const amount = (b: Base) => formatCenti(b.amountCenti, b.unit);

export function timeOffRequestedEmail(b: Base & { personName: string; note: string }): Email {
  return {
    subject: `${b.personName} asked for time off: ${when(b)}`,
    title: `${b.personName} asked for time off`,
    intro: `${b.personName} asked for ${amount(b)} of ${b.policyName} (${when(b)}) in ${b.workspaceName}.${b.note ? ` Their note: "${b.note}".` : ""}`,
    cta: { label: "Review the request", url: timeOffUrl(b) },
  };
}

export function timeOffDecisionEmail(
  b: Base & { decision: "APPROVED" | "REJECTED" | "CANCELLED"; note: string | null },
): Email {
  const note = b.note ? `: "${b.note}"` : ".";
  if (b.decision === "APPROVED") {
    return {
      subject: `Your time off was approved: ${when(b)}`,
      title: "Your time off was approved",
      intro: `Your ${b.policyName} for ${when(b)} (${amount(b)}) in ${b.workspaceName} was approved.`,
      cta: { label: "Open Time off", url: timeOffUrl(b) },
    };
  }
  if (b.decision === "REJECTED") {
    return {
      subject: `Your time off was not approved: ${when(b)}`,
      title: "Your time off was not approved",
      intro: `Your ${b.policyName} for ${when(b)} in ${b.workspaceName} was rejected${note}`,
      cta: { label: "Open Time off", url: timeOffUrl(b) },
    };
  }
  return {
    subject: `Your approved time off was cancelled: ${when(b)}`,
    title: "Your time off was cancelled",
    intro: `Your approved ${b.policyName} for ${when(b)} in ${b.workspaceName} was cancelled${note}`,
    cta: { label: "Open Time off", url: timeOffUrl(b) },
  };
}
