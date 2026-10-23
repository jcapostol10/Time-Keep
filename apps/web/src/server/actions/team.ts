"use server";

import { inviteMemberSchema } from "@timekeep/core";
import { and, eq, getDb, invitation, membership, user } from "@timekeep/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { getAuth } from "@/server/auth";
import { env } from "@/server/env";
import { invitationEmail, sendEmailOrExplain } from "@/server/mail";
import { requireWorkspaceAccess } from "@/server/workspace-access";

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

export async function inviteMemberAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const parsed = inviteMemberSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const db = getDb();
    const existing = await db
      .select({ id: membership.id })
      .from(membership)
      .innerJoin(user, eq(membership.userId, user.id))
      .where(and(eq(membership.workspaceId, ctx.workspace.id), eq(user.email, parsed.data.email)))
      .limit(1);
    if (existing.length > 0) {
      return fail("That person is already a member of this workspace.", {
        email: ["Already a member"],
      });
    }

    const result = await getAuth().api.createInvitation({
      headers: await headers(),
      body: {
        email: parsed.data.email,
        role: parsed.data.role,
        organizationId: ctx.workspace.id,
        resend: true,
      },
    });
    try {
      await sendEmailOrExplain(
        "invitation email",
        invitationMessage(ctx, result.id, result.email, result.role),
      );
    } catch (error) {
      // Nothing reached the invitee: take the invitation back so the admin can retry.
      await getAuth().api.cancelInvitation({
        headers: await headers(),
        body: { invitationId: result.id },
      });
      throw error;
    }

    revalidatePath(`/w/${slug}/team`);
    return ok({ invitationId: result.id });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function cancelInvitationAction(
  slug: string,
  invitationId: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
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
    const ctx = await requireWorkspaceAccess(slug, "admin");
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
