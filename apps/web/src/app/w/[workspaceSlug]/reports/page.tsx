import { redirect } from "next/navigation";

import { workspaceRoutes } from "@/lib/routes";

/** Reports open on the Summary view. */
export default async function ReportsPage({ params }: PageProps<"/w/[workspaceSlug]/reports">) {
  const { workspaceSlug } = await params;
  redirect(workspaceRoutes.reports(workspaceSlug, "summary"));
}
