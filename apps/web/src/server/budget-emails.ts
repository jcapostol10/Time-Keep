import type { EmailContent } from "./mail";

/** The budget alert of Phase 6b (decision 13), sent by the daily job through the outbox. */

type Email = { subject: string } & EmailContent;

export function budgetAlertEmail(b: {
  appUrl: string;
  slug: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  /** The threshold crossed (a whole percent). */
  threshold: number;
  /** Where the project stands now. */
  percent: number;
  /** Formatted: "2:00:00" or "$50.00". */
  usedText: string;
  estimateText: string;
  /** "November 2026" for a monthly estimate; null for the whole project. */
  periodLabel: string | null;
}): Email {
  return {
    subject: `${b.projectName} has passed ${b.threshold}% of its estimate`,
    title: `Budget alert: ${b.threshold}%`,
    intro: `${b.projectName} in ${b.workspaceName} has passed ${b.threshold}% of its ${b.estimateText} estimate${b.periodLabel ? ` for ${b.periodLabel}` : ""}: now at ${b.percent}% (${b.usedText}). Budgets are checked once a day.`,
    cta: {
      label: "Open the Budget tab",
      url: `${b.appUrl}/w/${b.slug}/projects/${b.projectId}/budget`,
    },
  };
}
