import { afterEach, describe, expect, it, vi } from "vitest";

import { CatalogError } from "../catalog/errors";
import { TimeEntryError } from "../time-entries";
import { WorkspaceAccessError } from "../workspace-access";
import { userErrorMessage } from "./errors";

describe("userErrorMessage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes through the message of a known, user-facing error", () => {
    expect(userErrorMessage(new WorkspaceAccessError(403, "You need the admin role."))).toBe(
      "You need the admin role.",
    );
    expect(userErrorMessage(new CatalogError("CONFLICT", 'A client named "Acme" exists.'))).toBe(
      'A client named "Acme" exists.',
    );
    expect(userErrorMessage(new TimeEntryError("INVALID", "This project is archived."))).toBe(
      "This project is archived.",
    );
  });

  it("hides anything else, such as a database error whose message is SQL and parameters", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const dbError = new Error('Failed query: insert into "client" (...) params: a,b,c');
    expect(userErrorMessage(dbError)).toBe("Something went wrong.");
    expect(userErrorMessage("not even an error")).toBe("Something went wrong.");
    expect(log).toHaveBeenCalled();
  });
});
