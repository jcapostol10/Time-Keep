/**
 * A refused request: 401 (no session), 403 (role or setting), 404 (not
 * there, or outside the viewer's scope). Its own module, free of Next
 * imports, so the permission code also loads in scripts (report:perf).
 */
export class WorkspaceAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}
