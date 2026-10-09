import { Building2Icon } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  return (
    <ComingSoon
      icon={Building2Icon}
      title="Clients"
      description="Keep the companies you work for in one list and group projects under them."
      phase={2}
    />
  );
}
