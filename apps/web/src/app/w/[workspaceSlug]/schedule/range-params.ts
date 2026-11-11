import "server-only";

import { localDateKey, resolveViewerPrefs } from "@timekeep/core";

import { rangeFor, startFor, type Zoom, zoomOf } from "@/components/schedule/schedule-model";
import type { WorkspaceContext } from "@/server/workspace-access";

/** The range a schedule page opens on: `?from=` (snapped to its zoom) or today's, and `?zoom=`. */
export function scheduleRangeParams(
  ctx: Pick<WorkspaceContext, "user" | "settings">,
  raw: Record<string, string | string[] | undefined>,
  allowed: readonly Zoom[] = ["week", "2weeks", "month"],
) {
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const today = localDateKey(new Date(), prefs.timezone);
  const asked = zoomOf(raw.zoom);
  const zoom = allowed.includes(asked) ? asked : "week";
  const fromRaw =
    typeof raw.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.from) ? raw.from : today;
  const from = startFor(fromRaw, zoom, prefs.weekStart);
  return { today, zoom, from, range: rangeFor(from, zoom), weekStart: prefs.weekStart };
}
