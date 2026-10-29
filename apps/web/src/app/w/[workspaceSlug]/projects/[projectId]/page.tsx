import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { TasksTab } from "@/components/projects/tasks-tab";
import { listTasks } from "@/server/catalog/tasks";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorizeProject } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Tasks" };

export default async function ProjectTasksPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() => authorizeProject(ctx, "project.update", projectId));
  const tasks = await listTasks(getDb(), viewer, projectId);

  return <TasksTab slug={workspaceSlug} projectId={projectId} tasks={tasks} />;
}
