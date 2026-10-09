import { FolderKanbanIcon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <ComingSoon
      icon={FolderKanbanIcon}
      title="Projects"
      description="Organise time by client, project and task, with access control and estimates."
      phase={2}
    />
  );
}
