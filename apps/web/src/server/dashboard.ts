import "server-only";

import {
  canReadTeam,
  type ReportGroup,
  type ReportQuery,
  type ReportTotals,
  type ViewerPrefs,
} from "@timekeep/core";
import { and, asc, type Database, desc, eq, isNull, project, timeEntry } from "@timekeep/db";

import { detailedParams } from "@/lib/report-links";
import type { SeriesPoint } from "@/lib/report-types";

import type { Viewer } from "./catalog/viewer";
import { listMembers } from "./queries/team";
import { summaryReport } from "./reports";
import { WorkspaceAccessError } from "./workspace-access";

/**
 * The dashboard reads through the report engine, so its numbers are the
 * Summary's: stopped entries only (a running timer shows on the Team tab
 * and in the timer bar, not in totals).
 */

export interface TopItem {
  label: string;
  seconds: number;
}

export interface MostTracked {
  description: string;
  projectName: string | null;
  seconds: number;
  /** The Detailed report's query string for this description, project and person. */
  detailedParams: string;
}

export interface DashboardMe {
  range: { from: string; to: string; label: string };
  totals: ReportTotals;
  series: SeriesPoint[];
  topProject: TopItem | null;
  topClient: TopItem | null;
  mostTracked: MostTracked[];
}

function top(groups: ReportGroup[]): TopItem | null {
  const first = groups.find((g) => g.id !== null);
  return first ? { label: first.label, seconds: first.totals.durationSeconds } : null;
}

/** The viewer's own picture for the range. */
export async function dashboardMe(
  db: Database,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now = new Date(),
): Promise<DashboardMe> {
  const own = { ...query, userIds: [viewer.userId] };
  const [byProject, byClient, byActivity] = await Promise.all([
    summaryReport(db, viewer, { ...own, groupBy: ["project"] }, prefs, now),
    summaryReport(db, viewer, { ...own, groupBy: ["client"] }, prefs, now),
    summaryReport(db, viewer, { ...own, groupBy: ["description", "project"] }, prefs, now),
  ]);
  const mostTracked = byActivity.groups
    .flatMap((d) =>
      d.children.map((p) => ({
        description: d.id ?? "",
        projectName: p.id === null ? null : p.label,
        seconds: p.totals.durationSeconds,
        detailedParams: detailedParams(
          own,
          [
            { key: "description", id: d.id },
            { key: "project", id: p.id },
          ],
          byActivity.range,
          prefs.timezone,
        ),
      })),
    )
    .sort((a, b) => b.seconds - a.seconds || a.description.localeCompare(b.description))
    .slice(0, 10);
  return {
    range: byProject.range,
    totals: byProject.totals,
    series: byProject.series,
    topProject: top(byProject.groups),
    topClient: top(byClient.groups),
    mostTracked,
  };
}

export interface TeamMember {
  userId: string;
  name: string;
  image: string | null;
  totalSeconds: number;
  /** Their newest entry, running or not. */
  latest: {
    description: string;
    projectName: string | null;
    start: string;
    end: string | null;
  } | null;
  running: boolean;
}

/** Every active member's total for the range, latest entry and whether a timer runs now. */
export async function dashboardTeam(
  db: Database,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now = new Date(),
): Promise<TeamMember[]> {
  if (!canReadTeam(viewer.role)) {
    throw new WorkspaceAccessError(403, "Only owners, admins and managers see the team.");
  }
  const [members, byUser, latestRows] = await Promise.all([
    listMembers(db, viewer.workspaceId),
    summaryReport(db, viewer, { ...query, userIds: [], groupBy: ["user"] }, prefs, now),
    db
      .selectDistinctOn([timeEntry.userId], {
        userId: timeEntry.userId,
        description: timeEntry.description,
        projectName: project.name,
        start: timeEntry.start,
        end: timeEntry.end,
      })
      .from(timeEntry)
      .leftJoin(project, eq(project.id, timeEntry.projectId))
      .where(and(eq(timeEntry.workspaceId, viewer.workspaceId), isNull(timeEntry.deletedAt)))
      .orderBy(asc(timeEntry.userId), desc(timeEntry.start)),
  ]);
  const totals = new Map(byUser.groups.map((g) => [g.id, g.totals.durationSeconds]));
  const latest = new Map(latestRows.map((r) => [r.userId, r]));
  return members
    .filter((m) => m.status === "ACTIVE")
    .map((m): TeamMember => {
      const l = latest.get(m.userId);
      return {
        userId: m.userId,
        name: m.name,
        image: m.image ?? null,
        totalSeconds: totals.get(m.userId) ?? 0,
        latest: l
          ? {
              description: l.description,
              projectName: l.projectName ?? null,
              start: l.start.toISOString(),
              end: l.end?.toISOString() ?? null,
            }
          : null,
        running: Boolean(l && l.end === null),
      };
    })
    .sort((a, b) => b.totalSeconds - a.totalSeconds || a.name.localeCompare(b.name));
}
