import { getDb } from "@timekeep/db";
import { Badge } from "@timekeep/ui/components/badge";
import { notFound } from "next/navigation";

import { ProjectTabs } from "@/components/projects/project-tabs";
import { ColorDot } from "@/components/tracker/project-picker";
import { CatalogError } from "@/server/catalog/errors";
import { getProject } from "@/server/catalog/projects";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorizeProject } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { can } from "@timekeep/core";

/** Project detail pages are for admins and the project's managers (the permission matrix). */
export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<"/w/[workspaceSlug]/projects/[projectId]">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/projects/${projectId}`,
  );
  const viewer = await authorizePage(() => authorizeProject(ctx, "project.update", projectId));
  const project = await getProject(getDb(), viewer, projectId).catch((error: unknown) => {
    if (error instanceof CatalogError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ColorDot color={project.color} className="size-3.5" />
          <span>{project.name}</span>
          {project.archived ? (
            <Badge variant="outline" className="ml-1 font-normal">
              Archived
            </Badge>
          ) : null}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {project.clientName ?? "No client"} ·{" "}
          {project.visibility === "PRIVATE" ? "Private" : "Public"}
          {project.billable ? " · Billable by default" : ""}
        </p>
      </div>
      <ProjectTabs
        slug={workspaceSlug}
        projectId={projectId}
        showRates={can(viewer.actor, "rate.view", { kind: "none" })}
      />
      <div className="mt-6">{children}</div>
    </>
  );
}
