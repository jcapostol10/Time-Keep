/**
 * The head of every workspace page: its title (20/600), at most one line
 * saying what the page is for, and its actions on the right (under the title
 * on a phone). Pages do not write their own h1.
 *
 * `mark` sits before the title (a project's colour dot), `meta` after it (a
 * status badge), both outside the heading so its text stays the page's name;
 * `children` go under the description (a project's progress bar). `wide`
 * marks a page of wide tables (reports, timesheet, team, the schedule grid).
 */
export function PageHeader({
  title,
  mark,
  meta,
  description,
  actions,
  children,
  className = "mb-6",
  wide = false,
}: {
  title: string;
  mark?: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** The space under the header; a page with tabs right below asks for less. */
  className?: string;
  /** A page of wide tables: the shell lets it past the 1200px column. */
  wide?: boolean;
}) {
  return (
    <div
      data-layout={wide ? "wide" : undefined}
      className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {mark}
          <h1 className="text-xl font-semibold">{title}</h1>
          {meta}
        </div>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
