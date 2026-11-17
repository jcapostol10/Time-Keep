/** The toast after Copy last week: what was copied, and what was skipped and why. */
export function copyWeekMessage(r: {
  created: number;
  duplicates: number;
  unusable: Array<{ description: string; reason: string }>;
}): string {
  const parts = [r.created === 1 ? "1 entry copied" : `${r.created} entries copied`];
  if (r.duplicates > 0) parts.push(`${r.duplicates} already there`);
  const [first, ...rest] = r.unusable;
  if (first) {
    const name = first.description || "(no description)";
    const more = rest.length > 0 ? ` (and ${rest.length} more)` : "";
    parts.push(`Skipped “${name}”: ${first.reason}${more}`);
  }
  return parts.join(". ");
}
