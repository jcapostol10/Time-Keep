import { can } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { NewClientButton } from "@/components/clients/client-dialog";
import { ClientsTable } from "@/components/clients/clients-table";
import { ClientsToolbar } from "@/components/clients/clients-toolbar";
import { PageHeader } from "@/components/page-header";
import { type ClientStatusFilter, listClients } from "@/server/catalog/clients";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Clients" };

const STATUSES: ClientStatusFilter[] = ["active", "archived", "all"];

export default async function ClientsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/clients">) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  // Whoever may create clients (the "who can create" setting) opens the page; others get
  // the same not-found page as for an unknown route. Editing stays with admins.
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/clients`);
  const viewer = await authorizePage(() => authorize(ctx, "client.create"));
  const canManage = can(viewer.actor, "client.update", { kind: "none" });

  const q = typeof query.q === "string" ? query.q : "";
  const statusRaw = typeof query.status === "string" ? query.status : "active";
  const status = STATUSES.find((s) => s === statusRaw) ?? "active";
  const clients = await listClients(getDb(), ctx.workspace.id, { q, status });

  return (
    <>
      <PageHeader
        title="Clients"
        description="The companies you work for. Group projects under them and bill them later."
        actions={<NewClientButton slug={workspaceSlug} />}
      />
      <ClientsToolbar q={q} status={status} />
      <ClientsTable
        slug={workspaceSlug}
        clients={clients}
        status={status}
        query={q}
        canManage={canManage}
      />
    </>
  );
}
