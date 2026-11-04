"use server";

import {
  capacitySchema,
  changeRoleSchema,
  convertLimitedSchema,
  inviteMembersSchema,
  limitedUserSchema,
  managerScopeSchema,
  memberStatusSchema,
  parseEmailList,
  pinSchema,
  transferOwnershipSchema,
} from "@timekeep/core";
import { and, eq, getDb, invitation } from "@timekeep/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { getAuth } from "@/server/auth";
import { env } from "@/server/env";
import {
  commitUserImport,
  type InviteResult,
  inviteMany,
  previewUserImport,
  type SendInvite,
} from "@/server/invites";
import { qrToken, setPin } from "@/server/kiosk/credentials";
import { convertLimitedUser, createLimitedUser } from "@/server/limited-users";
import { invitationEmail, sendEmailOrExplain } from "@/server/mail";
import {
  changeRole,
  removeMember,
  setCapacity,
  setManagerScope,
  setMemberStatus,
  transferOwnership,
} from "@/server/team";
import { requireWorkspaceAccess } from "@/server/workspace-access";
import { authorize } from "@/server/authz";

function invitationMessage(
  ctx: Awaited<ReturnType<typeof requireWorkspaceAccess>>,
  id: string,
  email: string,
  role: string,
) {
  return invitationEmail({
    id,
    appUrl: env().APP_URL,
    email,
    workspaceName: ctx.workspace.name,
    inviterName: ctx.user.name,
    inviterEmail: ctx.user.email,
    role,
  });
}

export async function cancelInvitationAction(
  slug: string,
  invitationId: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "member.invite");
    const row = await getDb().query.invitation.findFirst({
      where: and(eq(invitation.id, invitationId), eq(invitation.workspaceId, ctx.workspace.id)),
    });
    if (!row) return fail("Invitation not found.");

    await getAuth().api.cancelInvitation({
      headers: await headers(),
      body: { invitationId },
    });

    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function resendInvitationAction(
  slug: string,
  invitationId: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "member.invite");
    const row = await getDb().query.invitation.findFirst({
      where: and(eq(invitation.id, invitationId), eq(invitation.workspaceId, ctx.workspace.id)),
    });
    if (!row || row.status !== "pending") return fail("Invitation not found.");

    const result = await getAuth().api.createInvitation({
      headers: await headers(),
      body: {
        email: row.email,
        role: row.role as "admin" | "manager" | "member",
        organizationId: ctx.workspace.id,
        resend: true,
      },
    });
    await sendEmailOrExplain(
      "invitation email",
      invitationMessage(ctx, result.id, result.email, result.role),
    );

    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** The Team page, then the per-member rules (owner, self, scope) in server/team.ts. */
async function teamViewer(slug: string) {
  const ctx = await requireWorkspaceAccess(slug);
  return authorize(ctx, "page.view", { kind: "page", page: "team" });
}

export async function changeRoleAction(slug: string, input: unknown): Promise<ActionResult> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = changeRoleSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await changeRole(getDb(), viewer, parsed.data.userId, parsed.data.role);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function setMemberStatusAction(slug: string, input: unknown): Promise<ActionResult> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = memberStatusSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setMemberStatus(getDb(), viewer, parsed.data.userId, parsed.data.status);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function removeMemberAction(slug: string, userId: string): Promise<ActionResult> {
  try {
    const viewer = await teamViewer(slug);
    await removeMember(getDb(), viewer, userId);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function transferOwnershipAction(slug: string, input: unknown): Promise<ActionResult> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = transferOwnershipSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await transferOwnership(getDb(), viewer, parsed.data.userId, parsed.data.confirmName);
    revalidatePath(`/w/${slug}`, "layout");
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function setManagerScopeAction(slug: string, input: unknown): Promise<ActionResult> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = managerScopeSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { managerId, ...scope } = parsed.data;
    await setManagerScope(getDb(), viewer, managerId, scope);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** Daily and weekly hours and working days (Phase 5b): owners and admins, checked in setCapacity. */
export async function setCapacityAction(
  slug: string,
  userId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = capacitySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setCapacity(getDb(), viewer, userId, parsed.data);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/**
 * One invitation through Better Auth plus its email; a refused send takes
 * the invitation back so the address can be retried.
 */
function invitationSender(ctx: Awaited<ReturnType<typeof requireWorkspaceAccess>>): SendInvite {
  return async (email, role) => {
    const result = await getAuth().api.createInvitation({
      headers: await headers(),
      body: { email, role, organizationId: ctx.workspace.id, resend: true },
    });
    try {
      await sendEmailOrExplain(
        "invitation email",
        invitationMessage(ctx, result.id, result.email, result.role),
      );
    } catch (error) {
      await getAuth().api.cancelInvitation({
        headers: await headers(),
        body: { invitationId: result.id },
      });
      throw error;
    }
    return { invitationId: result.id };
  };
}

/** Many addresses at once, each with its own result (invited, already a member, …). */
export async function inviteMembersAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<InviteResult[]>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "member.invite");
    const parsed = inviteMembersSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const list = parseEmailList(parsed.data.emails);
    if (list.error) return fail(list.error, { emails: [list.error] });
    if (list.emails.length + list.invalid.length === 0) {
      return fail("Enter at least one email address.", { emails: ["Enter an email address"] });
    }
    const results = await inviteMany(
      getDb(),
      viewer,
      { emails: list.emails, role: parsed.data.role, groupIds: parsed.data.groupIds },
      invitationSender(ctx),
    );
    revalidatePath(`/w/${slug}/team`);
    return ok([
      ...results,
      ...list.invalid.map((email): InviteResult => ({ email, result: "invalid" })),
    ]);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function importUsersPreviewAction(
  slug: string,
  csv: string,
): Promise<ActionResult<Awaited<ReturnType<typeof previewUserImport>>>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "import.users");
    return ok(await previewUserImport(getDb(), viewer, String(csv)));
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function importUsersAction(
  slug: string,
  csv: string,
): Promise<ActionResult<{ invited: number; results: InviteResult[] }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "import.users");
    const result = await commitUserImport(getDb(), viewer, String(csv), invitationSender(ctx));
    if (result.error) return fail(result.error);
    revalidatePath(`/w/${slug}/team`);
    return ok({ invited: result.invited, results: result.results });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** Kiosk-only members (Phase 5c, decision 18); `member.manageLimited` is checked in the services. */
export async function addLimitedUserAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ userId: string }>> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = limitedUserSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createLimitedUser(getDb(), viewer, parsed.data);
    revalidatePath(`/w/${slug}/team`);
    return ok(created);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/**
 * A real address for a limited user, then Better Auth's reset-password email
 * to it (ruling R4): setting the password proves the address.
 */
export async function convertLimitedUserAction(
  slug: string,
  userId: string,
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = convertLimitedSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { email } = await convertLimitedUser(getDb(), viewer, userId, parsed.data);
    await getAuth().api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    revalidatePath(`/w/${slug}/team`);
    return ok({ email });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function setMemberPinAction(
  slug: string,
  userId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const viewer = await teamViewer(slug);
    const parsed = pinSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setPin(getDb(), viewer, userId, parsed.data.pin);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** A new QR code for a limited user (only its hash is kept). */
export async function memberQrAction(
  slug: string,
  userId: string,
): Promise<ActionResult<{ payload: string }>> {
  try {
    const viewer = await teamViewer(slug);
    return ok(await qrToken(getDb(), viewer, userId));
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
