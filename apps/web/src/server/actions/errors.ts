import "server-only";

import { APIError } from "better-auth/api";

import { CatalogError } from "@/server/catalog/errors";
import { TimeEntryError } from "@/server/time-entries";
import { WorkspaceAccessError } from "@/server/workspace-access";
import { type ActionResult, fail } from "@/lib/action-result";

/**
 * The message a server action may show the user. Known errors carry their
 * own (Better Auth's APIError included: its messages are written for the
 * person); anything else (a database error, a bug) is logged and hidden,
 * since its text would be SQL with parameters, or a stack.
 */
export function userErrorMessage(error: unknown): string {
  if (
    error instanceof WorkspaceAccessError ||
    error instanceof CatalogError ||
    error instanceof TimeEntryError ||
    error instanceof APIError
  ) {
    return error.message;
  }
  console.error("[action] unexpected error", error);
  return "Something went wrong.";
}

/** The failed result for an error; a required-field refusal names its field. */
export function actionFailure(error: unknown): ActionResult<never> {
  const message = userErrorMessage(error);
  if (error instanceof TimeEntryError && error.field) return fail(message, { [error.field]: [message] });
  return fail(message);
}
