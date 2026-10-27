import "server-only";

import {
  emailSchema,
  MAX_BULK_INVITES,
  parseCsv,
  planUserImport,
  type UserImportRow,
} from "@timekeep/core";
import {
  and,
  type Database,
  eq,
  inArray,
  invitation,
  invitationGroup,
  membership,
  user,
  userGroup,
  userGroupMember,
} from "@timekeep/db";

import { assertCan } from "./authz";
import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";
import { createGroup } from "./groups";
import type { AssignableRole } from "./team";

/**
 * Inviting many people at once, from a pasted list or a CSV. Each invitation
 * still goes through Better Auth and its email one at a time (`SendInvite`,
 * supplied by the action), so a refused send reports that address only.
 */

export const MAX_USER_IMPORT_BYTES = 1024 * 1024;

export type SendInvite = (email: string, role: AssignableRole) => Promise<{ invitationId: string }>;

export interface InviteResult {
  email: string;
  result: "invited" | "member" | "invited-already" | "invalid" | "failed";
  error?: string;
}

async function emailsHere(db: Database, workspaceId: string) {
  const [members, pending] = await Promise.all([
    db
      .select({ email: user.email })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.workspaceId, workspaceId)),
    db
      .select({ email: invitation.email })
      .from(invitation)
      .where(and(eq(invitation.workspaceId, workspaceId), eq(invitation.status, "pending"))),
  ]);
  return {
    existing: new Set(members.map((m) => m.email.toLowerCase())),
    pending: new Set(pending.map((p) => p.email.toLowerCase())),
  };
}

/** Invites each address in turn and says what happened to it, in input order. */
export async function inviteMany(
  db: Database,
  viewer: Viewer,
  input: { emails: string[]; role: AssignableRole; groupIds: string[] },
  send: SendInvite,
): Promise<InviteResult[]> {
  assertCan(viewer.actor, "member.invite", { kind: "none" });
  if (input.emails.length > MAX_BULK_INVITES) {
    throw new CatalogError("INVALID", `Invite at most ${MAX_BULK_INVITES} people at a time.`);
  }
  const groupIds = [...new Set(input.groupIds)];
  if (groupIds.length > 0) {
    const found = await db
      .select({ id: userGroup.id })
      .from(userGroup)
      .where(and(eq(userGroup.workspaceId, viewer.workspaceId), inArray(userGroup.id, groupIds)));
    if (found.length !== groupIds.length) throw new CatalogError("INVALID", "Group not found.");
  }
  const { existing, pending } = await emailsHere(db, viewer.workspaceId);

  const results: InviteResult[] = [];
  for (const raw of input.emails) {
    const parsed = emailSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ email: raw, result: "invalid" });
      continue;
    }
    const email = parsed.data;
    if (existing.has(email)) {
      results.push({ email, result: "member" });
      continue;
    }
    if (pending.has(email)) {
      results.push({ email, result: "invited-already" });
      continue;
    }
    try {
      const { invitationId } = await send(email, input.role);
      if (groupIds.length > 0) {
        await db
          .insert(invitationGroup)
          .values(groupIds.map((groupId) => ({ invitationId, groupId })))
          .onConflictDoNothing();
      }
      pending.add(email);
      results.push({ email, result: "invited" });
    } catch (error) {
      results.push({
        email,
        result: "failed",
        error: error instanceof Error ? error.message : "The invitation could not be sent.",
      });
    }
  }
  return results;
}

/** On acceptance: the new member joins the groups their invitation named. */
export async function joinInvitedGroups(
  db: Database,
  invitationId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ groupId: invitationGroup.groupId })
    .from(invitationGroup)
    .innerJoin(invitation, eq(invitation.id, invitationGroup.invitationId))
    .innerJoin(userGroup, eq(userGroup.id, invitationGroup.groupId))
    .where(
      and(
        eq(invitationGroup.invitationId, invitationId),
        eq(userGroup.workspaceId, invitation.workspaceId),
      ),
    );
  if (rows.length === 0) return;
  await db
    .insert(userGroupMember)
    .values(rows.map((r) => ({ groupId: r.groupId, userId })))
    .onConflictDoNothing();
}

async function plan(db: Database, viewer: Viewer, csv: string) {
  assertCan(viewer.actor, "import.users", { kind: "none" });
  if (new TextEncoder().encode(csv).length > MAX_USER_IMPORT_BYTES) {
    return { rows: [] as UserImportRow[], error: "Choose a file of at most 1 MB." };
  }
  const [{ existing, pending }, groups] = await Promise.all([
    emailsHere(db, viewer.workspaceId),
    db
      .select({ id: userGroup.id, name: userGroup.name })
      .from(userGroup)
      .where(eq(userGroup.workspaceId, viewer.workspaceId)),
  ]);
  return planUserImport(parseCsv(csv), {
    existingEmails: existing,
    pendingEmails: pending,
    groupNames: new Map(groups.map((g) => [g.name.toLowerCase(), g.id])),
  });
}

/** What importing this CSV would do, row by row; nothing is sent. */
export function previewUserImport(db: Database, viewer: Viewer, csv: string) {
  return plan(db, viewer, csv);
}

/**
 * Invites the rows the preview marked "ok", creating the groups they name
 * that do not exist yet. Re-plans from the file, so a stale preview cannot
 * send anything the current state refuses.
 */
export async function commitUserImport(
  db: Database,
  viewer: Viewer,
  csv: string,
  send: SendInvite,
): Promise<{ invited: number; results: InviteResult[]; error: string | null }> {
  const { rows, error } = await plan(db, viewer, csv);
  if (error) return { invited: 0, results: [], error };
  const ok = rows.filter((r) => r.status === "ok");
  const groupIds = new Map<string, string>();
  for (const name of new Set(ok.flatMap((r) => r.groups.filter((g) => !g.id).map((g) => g.name)))) {
    const created = await createGroup(db, viewer, name);
    groupIds.set(name.toLowerCase(), created.id);
  }
  const results: InviteResult[] = [];
  for (const row of ok) {
    const ids = row.groups.map((g) => g.id ?? groupIds.get(g.name.toLowerCase())!).filter(Boolean);
    results.push(
      ...(await inviteMany(
        db,
        viewer,
        { emails: [row.email], role: row.role, groupIds: ids },
        send,
      )),
    );
  }
  return { invited: results.filter((r) => r.result === "invited").length, results, error: null };
}
