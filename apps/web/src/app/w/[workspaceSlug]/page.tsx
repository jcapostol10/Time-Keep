import { redirect } from "next/navigation";

import { workspaceRoutes } from "@/lib/routes";

export default async function WorkspaceIndexPage({ params }: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  redirect(workspaceRoutes.tracker(workspaceSlug));
}
