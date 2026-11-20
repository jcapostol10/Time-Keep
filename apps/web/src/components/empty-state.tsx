import { cn } from "@timekeep/ui/lib/utils";

/**
 * What a page shows when its list has nothing in it: a title that says what
 * to do, one line of why, and the button that does it. No icon: the words
 * and the button are the invitation. Someone who may not create gets the
 * title as a statement ("No projects yet") and no button.
 *
 * For a page's main list only. "Nothing matches these filters", and a small
 * note inside a card or a dialog, are a line of muted text.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  /** The primary button that does what the title says. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-dashed px-6 py-10", className)}>
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A filter that matches nothing, or a list with nothing for this viewer to do: one quiet line. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed px-6 py-8 text-sm">
      {children}
    </p>
  );
}
