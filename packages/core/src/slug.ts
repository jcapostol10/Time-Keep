const MAX_SLUG_LENGTH = 48;

/** URL-safe slug: lowercase ASCII letters, digits and single hyphens. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "workspace";
}

/**
 * Returns `base` if free, else base-2, base-3, ... The caller supplies the
 * set of taken slugs (or a predicate) so this stays a pure function.
 */
export function uniqueSlug(base: string, isTaken: (candidate: string) => boolean): string {
  const root = slugify(base);
  if (!isTaken(root)) return root;
  for (let i = 2; i < 10_000; i++) {
    const suffix = `-${i}`;
    const candidate = `${root.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`Could not find a free slug for "${base}"`);
}

/** "Ada Lovelace" → "Ada's workspace"; empty name → "My workspace". */
export function personalWorkspaceName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "My workspace";
  return `${first}'s workspace`;
}
