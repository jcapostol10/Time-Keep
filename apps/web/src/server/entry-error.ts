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
