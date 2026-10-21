import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { AccessTab } from "@/components/projects/access-tab";
import { getProject } from "@/server/catalog/projects";
import { listMembers } from "@/server/queries/team";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Access" };

export default async function ProjectAccessPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/access">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug, "admin");
  const viewer = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
  const db = getDb();
  const [project, members] = await Promise.all([
    getProject(db, viewer, projectId),
    listMembers(db, ctx.workspace.id),
  ]);

  return (
    <AccessTab
      slug={workspaceSlug}
      project={project}
      members={members
        .filter((m) => m.status === "ACTIVE")
        .map((m) => ({ id: m.userId, name: m.name, email: m.email, image: m.image ?? null }))}
    />
  );
}
