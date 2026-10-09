import { CalendarDaysIcon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <ComingSoon
      icon={CalendarDaysIcon}
      title="Calendar"
      description="See your day and week as blocks; drag to create, move and resize entries."
      phase={2}
    />
  );
}
