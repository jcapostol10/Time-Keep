import { entryRulesOf, planAllows } from "@timekeep/core";
import { eq, getDb, project, task } from "@timekeep/db";
import type { Metadata } from "next";

import { KiosksPageClient } from "@/components/kiosk/kiosks-page-client";
import { PageHeader } from "@/components/page-header";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { listGroups } from "@/server/groups";
import { listKiosks } from "@/server/kiosk/kiosks";
import { listTeam } from "@/server/team";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Kiosks" };

/** Shared devices for clocking in without a login (owners and admins). */
export default async function KiosksPage({ params }: PageProps<"/w/[workspaceSlug]/kiosks">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() => authorize(ctx, "kiosk.manage"));
  const db = getDb();
  const [kiosks, team, groups, projects, tasks] = await Promise.all([
    listKiosks(db, viewer),
    listTeam(db, viewer, {}),
    listGroups(db, viewer),
    db
      .select({ id: project.id, name: project.name, color: project.color })
      .from(project)
      .where(eq(project.workspaceId, ctx.workspace.id)),
    db
      .select({ id: task.id, name: task.name })
      .from(task)
      .where(eq(task.workspaceId, ctx.workspace.id)),
  ]);
  const people = team.flatMap((r) =>
    r.kind === "member" && r.status === "ACTIVE" && r.userId
      ? [{ id: r.userId, name: r.name }]
      : [],
  );

  return (
    <>
      <PageHeader
        title="Kiosks"
        description="A shared device where people clock in with a PIN or a QR code, without signing in."
      />
      <KiosksPageClient
        slug={workspaceSlug}
        kiosks={kiosks}
        people={people}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        projects={projects}
        tasks={tasks}
        photoAllowed={planAllows(ctx.workspace, "kioskPhoto")}
        requiredFields={entryRulesOf(ctx.settings).requiredFields}
      />
    </>
  );
}
