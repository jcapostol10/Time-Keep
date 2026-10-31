import { formatDuration, formatPeriod, type Period } from "@timekeep/core";

import type { EmailContent } from "./mail";

/** The emails of Phase 5a's approvals; each links to where the reader acts. */

type Email = { subject: string } & EmailContent;

interface Base {
  appUrl: string;
  slug: string;
  workspaceName: string;
  period: Period;
}

const approvalsUrl = (b: Base) => `${b.appUrl}/w/${b.slug}/approvals`;
const requestUrl = (b: Base, id: string) => `${b.appUrl}/w/${b.slug}/approvals/${id}`;
const timesheetUrl = (b: Base) => `${b.appUrl}/w/${b.slug}/timesheet`;

export function submittedEmail(
  b: Base & { requestId: string; personName: string; workSeconds: number },
): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `${b.personName} submitted ${when} for approval`,
    title: `${b.personName} submitted their time`,
    intro: `${b.personName} submitted ${when} (${formatDuration(b.workSeconds, "hh:mm")}) in ${b.workspaceName} for your approval.`,
    cta: { label: "Review the period", url: requestUrl(b, b.requestId) },
  };
}

export function approvedEmail(b: Base): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `Your time for ${when} was approved`,
    title: "Your time was approved",
    intro: `Your time for ${when} in ${b.workspaceName} was approved.`,
    cta: { label: "Open your timesheet", url: timesheetUrl(b) },
  };
}

export function rejectedEmail(b: Base & { note: string }): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `Your time for ${when} needs changes`,
    title: "Your time needs changes",
    intro: `Your time for ${when} in ${b.workspaceName} was sent back: "${b.note}". Correct it and submit it again.`,
    cta: { label: "Open your timesheet", url: timesheetUrl(b) },
  };
}

export function reopenedEmail(b: Base & { note: string }): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `Your approved time for ${when} was reopened`,
    title: "Your approved time was reopened",
    intro: `Your approved time for ${when} in ${b.workspaceName} was reopened for correction: "${b.note}". Correct it and submit it again.`,
    cta: { label: "Open your timesheet", url: timesheetUrl(b) },
  };
}

export function unsubmittedReminderEmail(b: Base & { workSeconds: number }): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `Submit your time for ${when}`,
    title: "Your time is waiting to be submitted",
    intro: `You tracked ${formatDuration(b.workSeconds, "hh:mm")} in ${b.workspaceName} for ${when} and have not submitted it for approval yet.`,
    cta: { label: "Submit your time", url: timesheetUrl(b) },
    outro: "You can turn these reminders off in your profile settings.",
  };
}

export { approvalsUrl };
