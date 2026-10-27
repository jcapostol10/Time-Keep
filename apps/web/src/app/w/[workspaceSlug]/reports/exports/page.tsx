import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ExportsList } from "@/components/reports/exports-list";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize, authorizePage } from "@/server/authz";

export const metadata: Metadata = { title: "Exports" };

/** Large exports, prepared after the request and kept for seven days. */
export default async function ExportsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/reports/exports">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/exports`,
  );
  await authorizePage(() => authorize(ctx, "page.view", { kind: "page", page: "reports" }));
  return (
    <>
      <PageHeader
        title="Exports"
        description="Exports with many rows are prepared here and kept for seven days."
      />
      <ExportsList />
    </>
  );
}
