import "server-only";

/** Thrown by the catalog services; server actions turn it into a message. */
export class CatalogError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT" | "IN_USE",
    message: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

/** True when `error` is a Postgres unique violation on `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  if (typeof cause !== "object" || cause === null) return false;
  const pg = cause as { code?: string; constraint?: string };
  return pg.code === "23505" && pg.constraint === constraint;
}
