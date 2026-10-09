import { TimerIcon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Time Tracker" };

export default function TrackerPage() {
  return (
    <ComingSoon
      icon={TimerIcon}
      title="Time Tracker"
      description="Start and stop timers, add time manually and review your entries by day."
      phase={1}
    />
  );
}
