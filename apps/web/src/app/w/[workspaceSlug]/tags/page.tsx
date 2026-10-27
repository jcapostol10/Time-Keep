import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { NewTagButton } from "@/components/tags/tag-dialog";
import { TagsTable } from "@/components/tags/tags-table";
import { TagsToolbar } from "@/components/tags/tags-toolbar";
import { listTags } from "@/server/catalog/tags";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Tags" };

type Status = "active" | "archived" | "all";
const STATUSES: Status[] = ["active", "archived", "all"];

export default async function TagsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/tags">) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  // Admins only: members get the same not-found page as for an unknown route.
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/tags`);
  await authorizePage(() => authorize(ctx, "tag.update"));
  const statusRaw = typeof query.status === "string" ? query.status : "active";
  const status = STATUSES.find((s) => s === statusRaw) ?? "active";

  const all = await listTags(getDb(), ctx.workspace.id, { includeArchived: true });
  const tags = status === "all" ? all : all.filter((t) => t.archived === (status === "archived"));

  return (
    <>
      <PageHeader
        title="Tags"
        description="Labels for entries across projects. Filter reports by them later."
        actions={<NewTagButton slug={workspaceSlug} />}
      />
      <TagsToolbar status={status} />
      <TagsTable slug={workspaceSlug} tags={tags} status={status} />
    </>
  );
}
