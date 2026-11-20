import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

/** Placeholder for pages scheduled in a later phase. */
export function ComingSoon({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: number;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={`${title} is coming in Phase ${phase}`} description={description} />
    </>
  );
}
