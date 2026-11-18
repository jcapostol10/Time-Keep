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
/** The timesheet at the period's first week, where sent-back time is corrected. */
const periodWeekUrl = (b: Base) => `${timesheetUrl(b)}?week=${b.period.start}`;

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

export function approvedEmail(b: Base & { requestId: string }): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `Your time for ${when} was approved`,
    title: "Your time was approved",
    intro: `Your time for ${when} in ${b.workspaceName} was approved.`,
    cta: { label: "Open the period", url: requestUrl(b, b.requestId) },
  };
}

export function rejectedEmail(b: Base & { note: string }): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `Your time for ${when} needs changes`,
    title: "Your time needs changes",
    intro: `Your time for ${when} in ${b.workspaceName} was sent back: "${b.note}". Correct it and submit it again.`,
    cta: { label: "Correct your time", url: periodWeekUrl(b) },
  };
}

export function reopenedEmail(b: Base & { note: string }): Email {
  const when = formatPeriod(b.period);
  return {
    subject: `Your approved time for ${when} was reopened`,
    title: "Your approved time was reopened",
    intro: `Your approved time for ${when} in ${b.workspaceName} was reopened for correction: "${b.note}". Correct it and submit it again.`,
    cta: { label: "Correct your time", url: periodWeekUrl(b) },
  };
}

export function unsubmittedReminderEmail(
  b: Base & { workSeconds: number; expenseCount?: number },
): Email {
  const when = formatPeriod(b.period);
  const expenses = b.expenseCount ?? 0;
  const expenseText = `${expenses} ${expenses === 1 ? "expense" : "expenses"}`;
  // A period can hold time, expenses or both: the email names what is waiting.
  if (b.workSeconds <= 0 && expenses > 0) {
    return {
      subject: `Submit your expenses for ${when}`,
      title: "Your expenses are waiting to be submitted",
      intro: `You recorded ${expenseText} in ${b.workspaceName} for ${when} and have not submitted ${expenses === 1 ? "it" : "them"} for approval yet.`,
      cta: { label: "Submit your period", url: timesheetUrl(b) },
      outro: "You can turn these reminders off in your profile settings.",
    };
  }
  const tracked = `You tracked ${formatDuration(b.workSeconds, "hh:mm")}`;
  return {
    subject: `Submit your time for ${when}`,
    title: "Your time is waiting to be submitted",
    intro:
      expenses > 0
        ? `${tracked} and recorded ${expenseText} in ${b.workspaceName} for ${when} and have not submitted them for approval yet.`
        : `${tracked} in ${b.workspaceName} for ${when} and have not submitted it for approval yet.`,
    cta: { label: "Submit your time", url: timesheetUrl(b) },
    outro: "You can turn these reminders off in your profile settings.",
  };
}

export { approvalsUrl };
