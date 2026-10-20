import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { ProjectSettingsTab } from "@/components/projects/project-settings-tab";
import { listClientOptions } from "@/server/catalog/clients";
import { getProject, listProjects } from "@/server/catalog/projects";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Project settings" };

export default async function ProjectSettingsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/settings">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug, "admin");
  const viewer = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
  const db = getDb();
  const [project, clients, others] = await Promise.all([
    getProject(db, viewer, projectId),
    listClientOptions(db, ctx.workspace.id),
    listProjects(db, viewer, {
      q: "",
      status: "active",
      billing: "all",
      access: "all",
      sort: "name",
      dir: "asc",
    }),
  ]);

  return (
    <ProjectSettingsTab
      slug={workspaceSlug}
      project={project}
      clients={clients}
      others={others.filter((p) => p.id !== projectId)}
    />
  );
}
