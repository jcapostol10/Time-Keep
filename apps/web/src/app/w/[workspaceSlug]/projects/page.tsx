import { can, projectListQuerySchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { NewProjectButton } from "@/components/projects/project-dialog";
import { ProjectsTable } from "@/components/projects/projects-table";
import { ProjectsToolbar } from "@/components/projects/projects-toolbar";
import { listClientOptions, listFilterClients } from "@/server/catalog/clients";
import { listProjects } from "@/server/catalog/projects";
import { requireWorkspacePage } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/projects">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/projects`);
  const viewer = await viewerFor(ctx);
  // Admins manage every project; a project's managers open their own; the
  // workspace's "who can create projects" setting decides the New button.
  const newProject = { kind: "project" as const, projectId: null };
  const canManage = can(viewer.actor, "project.delete", newProject);
  const canCreate = can(viewer.actor, "project.create", newProject);
  const editableIds = [...viewer.actor.managedProjectIds];

  // Unknown or malformed filters fall back to the defaults rather than erroring.
  const parsed = projectListQuerySchema.safeParse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    clientId: typeof raw.client === "string" && raw.client ? raw.client : undefined,
    status: raw.status,
    billing: raw.billing,
    access: raw.access,
    kind: raw.kind,
    sort: raw.sort,
    dir: raw.dir,
  });
  const query = parsed.success ? parsed.data : projectListQuerySchema.parse({});

  const db = getDb();
  const [projects, clients, filterClients, templates] = await Promise.all([
    listProjects(db, viewer, query),
    // Every client for the dialogs; the filter only names clients of projects the viewer sees.
    listClientOptions(db, ctx.workspace.id),
    listFilterClients(db, viewer),
    // "Start from template" lists every template the viewer can see.
    listProjects(db, viewer, {
      ...query,
      q: "",
      clientId: undefined,
      status: "all",
      kind: "templates",
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          canManage
            ? "What time is tracked against. Group projects by client and control who can see them."
            : "The projects you can track time on."
        }
        actions={
          canCreate ? (
            <NewProjectButton slug={workspaceSlug} clients={clients} templates={templates} />
          ) : null
        }
      />
      <ProjectsToolbar query={query} clients={filterClients} />
      <ProjectsTable
        slug={workspaceSlug}
        projects={projects}
        clients={clients}
        query={query}
        canManage={canManage}
        editableIds={editableIds}
      />
    </>
  );
}
