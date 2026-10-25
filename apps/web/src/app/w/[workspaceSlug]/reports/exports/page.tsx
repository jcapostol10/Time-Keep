import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ExportsList } from "@/components/reports/exports-list";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Exports" };

/** Large exports, prepared after the request and kept for seven days. */
export default async function ExportsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/reports/exports">) {
  const { workspaceSlug } = await params;
  await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/reports/exports`);
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
