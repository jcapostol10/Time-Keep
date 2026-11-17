import type { RequiredField } from "@timekeep/core";

export class TimeEntryError extends Error {
  constructor(
    /** NOTE_REQUIRED: an owner or admin changes submitted time without saying why (Phase 5a). */
    public readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT" | "NOTE_REQUIRED",
    message: string,
    /** The required field the entry lacks, for the UI to mark. */
    public readonly field?: RequiredField,
  ) {
    super(message);
    this.name = "TimeEntryError";
  }
}

/**
 * An entry's details can no longer take new time (a missing, archived or
 * unavailable project, task or tag). Still an INVALID TimeEntryError for every
 * caller; a batch that copies entries one by one (copy week) skips the entry
 * instead of failing.
 */
export class DetailUnusableError extends TimeEntryError {
  constructor(message: string) {
    super("INVALID", message);
    this.name = "DetailUnusableError";
  }
}
