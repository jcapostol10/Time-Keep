import { can, localDateKey, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { mayReviewAny } from "@/components/shell/nav-items";
import { type TimeOffPageTab, TimeOffPageClient } from "@/components/time-off/time-off-page-client";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { assigneeOptions } from "@/server/time-off/people";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Time off" };

const TABS: readonly TimeOffPageTab[] = [
  "requests",
  "calendar",
  "balances",
  "policies",
  "holidays",
];

/**
 * Time off (Phase 5b): everyone's own requests and balances; reviewers also
 * what they review; owners and admins the policies and holidays.
 */
export default async function TimeOffPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/time-off">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() =>
    authorize(ctx, "timeOff.request", { kind: "person", userId: ctx.user.id }),
  );
  const manages = can(viewer.actor, "timeOff.manage", { kind: "none" });
  const tabs = TABS.filter((t) => manages || (t !== "policies" && t !== "holidays"));
  const tab = tabs.find((t) => t === raw.tab) ?? "requests";
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const thisYear = Number(localDateKey(new Date(), prefs.timezone).slice(0, 4));
  const asked = Number(raw.year);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : thisYear;
  const options = manages
    ? await assigneeOptions(getDb(), ctx.workspace.id)
    : { people: [], groups: [] };
  return (
    <>
      <PageHeader
        title="Time off"
        description="Ask for time off, see who is away and how much time off is left."
      />
      <TimeOffPageClient
        slug={workspaceSlug}
        tab={tab}
        tabs={tabs}
        year={year}
        manages={manages}
        reviewer={mayReviewAny(viewer.actor)}
        seesTeam={viewer.role !== "member" || viewer.actor.settings.membersSeeTeamTime}
        people={options.people}
        groups={options.groups}
      />
    </>
  );
}
