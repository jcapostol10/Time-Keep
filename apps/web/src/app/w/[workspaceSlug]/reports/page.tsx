import { BarChart3Icon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <ComingSoon
      icon={BarChart3Icon}
      title="Reports"
      description="Summary, detailed and weekly reports with filters, sharing and exports."
      phase={3}
    />
  );
}
