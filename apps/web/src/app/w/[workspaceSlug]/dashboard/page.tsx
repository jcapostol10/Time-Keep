import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <ComingSoon
      icon={LayoutDashboardIcon}
      title="Dashboard"
      description="Your totals, top projects and what the team is working on right now."
      phase={3}
    />
  );
}
