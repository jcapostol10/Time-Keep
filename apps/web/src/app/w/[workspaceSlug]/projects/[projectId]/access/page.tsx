import { eq, getDb, projectGroup } from "@timekeep/db";
import type { Metadata } from "next";

import { AccessTab } from "@/components/projects/access-tab";
import { getProject } from "@/server/catalog/projects";
import { listGroups } from "@/server/groups";
import { listMembers } from "@/server/queries/team";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorizeProject } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Access" };

export default async function ProjectAccessPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/access">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() =>
    authorizeProject(ctx, "project.manageMembers", projectId),
  );
  const db = getDb();
  const [project, members, groups, projectGroups] = await Promise.all([
    getProject(db, viewer, projectId),
    listMembers(db, ctx.workspace.id),
    listGroups(db, viewer),
    db
      .select({ groupId: projectGroup.groupId })
      .from(projectGroup)
      .where(eq(projectGroup.projectId, projectId)),
  ]);

  return (
    <AccessTab
      slug={workspaceSlug}
      project={project}
      members={members
        .filter((m) => m.status === "ACTIVE")
        .map((m) => ({ id: m.userId, name: m.name, email: m.email, image: m.image ?? null }))}
      groups={groups.map((g) => ({ id: g.id, name: g.name }))}
      groupIds={projectGroups.map((g) => g.groupId)}
    />
  );
}
