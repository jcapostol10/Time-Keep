import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { SharedList } from "@/components/reports/shared-list";
import { listShareLinks } from "@/server/share-links";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize, authorizePage } from "@/server/authz";

export const metadata: Metadata = { title: "Shared reports" };

/** Share links of the workspace (team readers) or one's own (members). */
export default async function SharedReportsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/reports/shared">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/shared`,
  );
  const viewer = await authorizePage(() =>
    authorize(ctx, "page.view", { kind: "page", page: "reports" }),
  );
  const links = await listShareLinks(getDb(), viewer);
  return (
    <>
      <PageHeader
        title="Shared reports"
        description="Anyone with one of these links can see its report without signing in."
      />
      <SharedList links={links} />
    </>
  );
}
