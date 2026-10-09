import { getDb } from "@timekeep/db";

import { AppShell } from "@/components/shell/app-shell";
import { listUserWorkspaces, requireWorkspacePage } from "@/server/workspace-access";

export default async function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}`);
  const workspaces = await listUserWorkspaces(getDb(), ctx.user.id);

  return (
    <AppShell
      user={{ name: ctx.user.name, email: ctx.user.email, image: ctx.user.image ?? null }}
      workspace={{
        id: ctx.workspace.id,
        name: ctx.workspace.name,
        slug: ctx.workspace.slug,
        role: ctx.role,
      }}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: w.role }))}
    >
      {children}
    </AppShell>
  );
}
