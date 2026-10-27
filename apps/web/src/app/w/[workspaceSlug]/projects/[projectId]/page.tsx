import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { TasksTab } from "@/components/projects/tasks-tab";
import { listTasks } from "@/server/catalog/tasks";
import { listMembers } from "@/server/queries/team";
import { requireWorkspacePage } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

export const metadata: Metadata = { title: "Tasks" };

export default async function ProjectTasksPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug, "admin");
  const viewer = await viewerFor(ctx);
  const db = getDb();
  const [tasks, members] = await Promise.all([
    listTasks(db, viewer, projectId),
    listMembers(db, ctx.workspace.id),
  ]);

  return (
    <TasksTab
      slug={workspaceSlug}
      projectId={projectId}
      tasks={tasks}
      members={members
        .filter((m) => m.status === "ACTIVE")
        .map((m) => ({ id: m.userId, name: m.name, image: m.image ?? null }))}
    />
  );
}
