import {
  addDaysInZone,
  localDateKey,
  monthBoundsInZone,
  resolveViewerPrefs,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { StatusTab } from "@/components/projects/status-tab";
import { getProjectStatus } from "@/server/catalog/projects";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Status" };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function ProjectStatusPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/status">) {
  const { workspaceSlug, projectId } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "admin");
  const viewer = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const tz = prefs.timezone;

  // Inclusive local dates in the URL; default to this month.
  const now = new Date();
  const month = monthBoundsInZone(now, tz);
  const fromKey =
    typeof raw.from === "string" && DATE_KEY.test(raw.from)
      ? raw.from
      : localDateKey(month.monthStart, tz);
  const toKey =
    typeof raw.to === "string" && DATE_KEY.test(raw.to)
      ? raw.to
      : localDateKey(addDaysInZone(month.monthEnd, -1, tz), tz);
  const from = zonedDateTimeToInstant({ date: fromKey, hours: 0, minutes: 0 }, tz);
  const to = addDaysInZone(
    zonedDateTimeToInstant({ date: toKey, hours: 0, minutes: 0 }, tz),
    1,
    tz,
  );

  const status = await getProjectStatus(getDb(), viewer, projectId, {
    from,
    to: to > from ? to : addDaysInZone(from, 1, tz),
  });

  return (
    <StatusTab
      status={status}
      fromKey={fromKey}
      toKey={toKey}
      timezone={tz}
      weekStart={prefs.weekStart}
      durationFormat={prefs.durationFormat}
    />
  );
}
