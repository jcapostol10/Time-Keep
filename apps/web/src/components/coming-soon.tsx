import type { LucideIcon } from "lucide-react";

import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

/** Placeholder for pages scheduled in a later phase. */
export function ComingSoon({
  icon,
  title,
  description,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: number;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={icon}
        title={`${title} is coming in Phase ${phase}`}
        description={description}
      />
    </>
  );
}
