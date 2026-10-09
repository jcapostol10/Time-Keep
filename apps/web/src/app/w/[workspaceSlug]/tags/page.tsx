import { TagIcon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Tags" };

export default function TagsPage() {
  return (
    <ComingSoon
      icon={TagIcon}
      title="Tags"
      description="Label time entries across projects and filter reports by them."
      phase={2}
    />
  );
}
