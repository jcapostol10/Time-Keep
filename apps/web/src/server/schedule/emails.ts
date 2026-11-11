import { formatDuration, formatTimeOffDates, type HoursMode } from "@timekeep/core";

import type { EmailContent } from "../mail";

/** The email a Publish sends each person whose plan changed (decision 10). */

type Email = { subject: string } & EmailContent;

export interface ScheduleEmailItem {
  startDate: string;
  endDate: string;
  projectName: string;
  taskName: string | null;
  mode: HoursMode;
  minutesPerDay: number | null;
  totalMinutes: number | null;
  note: string;
}

const hours = (minutes: number) => formatDuration(minutes * 60, "hh:mm");

export function scheduleItemLine(i: ScheduleEmailItem): string {
  const what = i.taskName ? `${i.projectName} · ${i.taskName}` : i.projectName;
  const amount =
    i.mode === "PER_DAY"
      ? `${hours(i.minutesPerDay ?? 0)} a day`
      : `${hours(i.totalMinutes ?? 0)} in total`;
  return `${formatTimeOffDates(i.startDate, i.endDate)} · ${what} · ${amount}${i.note ? ` (${i.note})` : ""}`;
}

export function schedulePublishedEmail(b: {
  appUrl: string;
  slug: string;
  workspaceName: string;
  items: ScheduleEmailItem[];
}): Email {
  return {
    subject: `Your schedule in ${b.workspaceName} was updated`,
    title: "Your schedule was updated",
    intro: b.items.length
      ? `Here is what you are scheduled for in ${b.workspaceName} over the next four weeks.`
      : `You have nothing scheduled in ${b.workspaceName} in the next four weeks.`,
    items: b.items.map(scheduleItemLine),
    cta: { label: "Open My schedule", url: `${b.appUrl}/w/${b.slug}/schedule/mine` },
  };
}
