import { TableIcon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Timesheet" };

export default function TimesheetPage() {
  return (
    <ComingSoon
      icon={TableIcon}
      title="Timesheet"
      description="Fill in a weekly grid of projects and tasks, copy last week and save templates."
      phase={2}
    />
  );
}
