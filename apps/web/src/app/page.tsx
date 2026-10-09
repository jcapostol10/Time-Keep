import { redirect } from "next/navigation";

import { getSession } from "@/server/session";
import { resolveHomeWorkspace } from "@/server/workspace-access";

/**
 * Root route: send signed-in users to their active (or first) workspace,
 * everyone else to sign-in.
 */
export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const home = await resolveHomeWorkspace(session);
  if (!home) redirect("/workspaces/new");

  redirect(`/w/${home.slug}/tracker`);
}
