import { formatDateKey, formatDuration, formatPeriod, type TargetPeriod } from "@timekeep/core";

import type { EmailContent } from "./mail";

/** The emails of Phase 5b's target rules (decision 14), sent by the daily job. */

type Email = { subject: string } & EmailContent;

interface Base {
  appUrl: string;
  slug: string;
  workspaceName: string;
  period: TargetPeriod;
  /** The day, or the week's first day. */
  dateKey: string;
  /** The week's last day (WEEK rules). */
  endKey: string;
  workSeconds: number;
  thresholdMinutes: number;
}

const when = (b: Base) =>
  b.period === "DAY"
    ? `on ${formatDateKey(b.dateKey)}`
    : `in the week of ${formatPeriod({ start: b.dateKey, end: b.endKey })}`;
const hours = (seconds: number) => formatDuration(seconds, "hh:mm");

export function underTargetEmail(b: Base): Email {
  return {
    subject: `You tracked ${hours(b.workSeconds)} ${when(b)}`,
    title: "Your tracked time is under the target",
    intro: `You tracked ${hours(b.workSeconds)} ${when(b)} in ${b.workspaceName}, under the target of ${hours(b.thresholdMinutes * 60)}. If time is missing, add it now.`,
    cta: { label: "Open your timesheet", url: `${b.appUrl}/w/${b.slug}/timesheet` },
    outro: "You can mute target reminders in your profile settings.",
  };
}

export function overTargetEmail(b: Base & { personName: string; userId: string }): Email {
  return {
    subject: `${b.personName} tracked ${hours(b.workSeconds)} ${when(b)}`,
    title: "Tracked time over the target",
    intro: `${b.personName} tracked ${hours(b.workSeconds)} ${when(b)} in ${b.workspaceName}, over the target of ${hours(b.thresholdMinutes * 60)}.`,
    cta: {
      label: "Open the Attendance report",
      url: `${b.appUrl}/w/${b.slug}/reports/attendance?userIds=${encodeURIComponent(b.userId)}`,
    },
  };
}
