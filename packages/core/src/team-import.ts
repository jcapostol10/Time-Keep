import type { Role } from "./roles";
import { emailSchema } from "./schemas";

/**
 * Inviting many people at once: a pasted list of addresses, or a CSV with
 * `email`, `role` and `groups` columns. Pure planning only; the server
 * looks up who is already a member or invited and sends the invitations.
 */

export const MAX_BULK_INVITES = 100;
export const MAX_USER_IMPORT_ROWS = 500;

const ASSIGNABLE = ["admin", "manager", "member"] as const;
type Assignable = (typeof ASSIGNABLE)[number];

function validEmail(text: string): boolean {
  return emailSchema.safeParse(text).success;
}

/** Addresses from pasted text: commas, semicolons, spaces or new lines between them. */
export function parseEmailList(text: string): {
  emails: string[];
  invalid: string[];
  error: string | null;
} {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const value = raw.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    (validEmail(value) ? emails : invalid).push(value);
  }
  const error =
    emails.length > MAX_BULK_INVITES
      ? `Invite at most ${MAX_BULK_INVITES} people at a time.`
      : null;
  return { emails, invalid, error };
}

export type UserImportStatus =
  "ok" | "invalid-email" | "unknown-role" | "owner-role" | "member" | "invited" | "duplicate";

export interface UserImportRow {
  /** 1-based line in the file, header included */
  line: number;
  email: string;
  role: Assignable;
  /** id null: the group does not exist yet and is created on import */
  groups: { name: string; id: string | null }[];
  status: UserImportStatus;
}

export interface UserImportContext {
  existingEmails: ReadonlySet<string>;
  pendingEmails: ReadonlySet<string>;
  /** lowercased group name → id */
  groupNames: ReadonlyMap<string, string>;
}

/** What importing these rows would do, row by row. */
export function planUserImport(
  rows: string[][],
  ctx: UserImportContext,
): { rows: UserImportRow[]; error: string | null } {
  const [header, ...data] = rows;
  const columns = (header ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => columns.indexOf(name);
  const emailCol = col("email");
  if (emailCol < 0) return { rows: [], error: "The file needs an email column." };
  if (data.length > MAX_USER_IMPORT_ROWS) {
    return { rows: [], error: `Import at most ${MAX_USER_IMPORT_ROWS} people at a time.` };
  }
  const roleCol = col("role");
  const groupsCol = col("groups");
  const seen = new Set<string>();

  const planned = data.map((cells, i): UserImportRow => {
    const email = (cells[emailCol] ?? "").trim().toLowerCase();
    const roleText = (roleCol >= 0 ? (cells[roleCol] ?? "") : "").trim().toLowerCase();
    const known = ASSIGNABLE.find((r) => r === roleText);
    const names = new Map<string, string>();
    for (const part of (groupsCol >= 0 ? (cells[groupsCol] ?? "") : "").split(";")) {
      const name = part.trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    const groups = [...names].map(([lower, name]) => ({
      name,
      id: ctx.groupNames.get(lower) ?? null,
    }));

    let status: UserImportStatus = "ok";
    if (!validEmail(email)) status = "invalid-email";
    else if (roleText === ("owner" satisfies Role)) status = "owner-role";
    else if (roleText && !known) status = "unknown-role";
    else if (ctx.existingEmails.has(email)) status = "member";
    else if (ctx.pendingEmails.has(email)) status = "invited";
    else if (seen.has(email)) status = "duplicate";
    if (validEmail(email)) seen.add(email);

    return { line: i + 2, email, role: known ?? "member", groups, status };
  });
  return { rows: planned, error: null };
}
