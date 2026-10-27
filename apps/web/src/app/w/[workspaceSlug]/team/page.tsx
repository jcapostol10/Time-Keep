import { can, isRole } from "@timekeep/core";
import { asc, eq, getDb, project } from "@timekeep/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { RecalcBanner } from "@/components/rates/recalc-banner";
import { TeamView } from "@/components/team/team-view";
import type { TeamStatus } from "@/lib/team-types";
import { authorize, authorizePage } from "@/server/authz";
import { listGroups } from "@/server/groups";
import { listTeam } from "@/server/team";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Team" };

const STATUSES: TeamStatus[] = ["ACTIVE", "INVITED", "DEACTIVATED"];

/** Members and invites (filters in the URL), and the workspace's groups. */
export default async function TeamPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/team">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() =>
    authorize(ctx, "page.view", { kind: "page", page: "team" }),
  );
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const role = text(raw.role);
  const statusParam = text(raw.status)?.toUpperCase();
  const status = STATUSES.find((s) => s === statusParam);

  const db = getDb();
  const can_ = (action: Parameters<typeof can>[1]) => can(viewer.actor, action, { kind: "none" });
  const canManage = can_("member.invite");
  const [rows, groups, everyone, projects] = await Promise.all([
    listTeam(db, viewer, {
      q: text(raw.q),
      role: role && isRole(role) ? role : undefined,
      groupId: text(raw.group),
      status,
    }),
    listGroups(db, viewer),
    // The scope and group dialogs list everyone, whatever the filters show.
    canManage ? listTeam(db, viewer, {}) : Promise.resolve([]),
    canManage
      ? db
          .select({ id: project.id, name: project.name })
          .from(project)
          .where(eq(project.workspaceId, ctx.workspace.id))
          .orderBy(asc(project.name))
      : Promise.resolve([]),
  ]);
  const active = (rows: typeof everyone) =>
    rows
      .filter((r) => r.kind === "member" && r.status === "ACTIVE")
      .map((r) => ({ id: r.userId!, name: r.name }));

  return (
    <>
      <PageHeader
        title="Team"
        description={`Everyone in ${ctx.workspace.name}, their roles, groups and rates.`}
      />
      {can_("rate.view") ? <RecalcBanner slug={workspaceSlug} /> : null}
      <TeamView
        slug={workspaceSlug}
        workspaceName={ctx.workspace.name}
        meId={ctx.user.id}
        rows={rows}
        groups={groups}
        people={active(everyone)}
        projects={projects}
        filters={{
          q: text(raw.q) ?? "",
          role: role && isRole(role) ? role : "",
          group: text(raw.group) ?? "",
          status: status ?? (text(raw.status) === "all" ? "all" : ""),
        }}
        permissions={{
          manage: canManage,
          groups: can_("group.manage"),
          import: can_("import.users"),
          rates: can_("rate.view"),
          transfer: can(viewer.actor, "workspace.transferOwnership", { kind: "workspace" }),
        }}
        currency={ctx.settings.currency}
        timezone={ctx.settings.timezone}
      />
    </>
  );
}
