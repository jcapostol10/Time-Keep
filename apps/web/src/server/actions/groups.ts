"use server";

import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import {
  createGroup,
  deleteGroup,
  type GroupDTO,
  renameGroup,
  setGroupMembers,
  setUserGroups,
} from "@/server/groups";
import { requireWorkspaceAccess } from "@/server/workspace-access";

const nameSchema = z.object({ name: z.string().trim().min(1, "Give the group a name").max(100) });
const membersSchema = z.object({ userIds: z.array(z.string().min(1).max(64)).max(500) });

async function groupViewer(slug: string) {
  const ctx = await requireWorkspaceAccess(slug);
  return authorize(ctx, "group.manage");
}

export async function createGroupAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<GroupDTO>> {
  try {
    const viewer = await groupViewer(slug);
    const parsed = nameSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const group = await createGroup(getDb(), viewer, parsed.data.name);
    revalidatePath(`/w/${slug}/team`);
    return ok(group);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function renameGroupAction(
  slug: string,
  groupId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const viewer = await groupViewer(slug);
    const parsed = nameSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await renameGroup(getDb(), viewer, groupId, parsed.data.name);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function deleteGroupAction(slug: string, groupId: string): Promise<ActionResult> {
  try {
    const viewer = await groupViewer(slug);
    await deleteGroup(getDb(), viewer, groupId);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function setGroupMembersAction(
  slug: string,
  groupId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const viewer = await groupViewer(slug);
    const parsed = membersSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setGroupMembers(getDb(), viewer, groupId, parsed.data.userIds);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

const userGroupsSchema = z.object({
  userId: z.string().min(1).max(64),
  groupIds: z.array(z.string().min(1).max(64)).max(100),
});

/** A person's groups, from their row on the Team page. */
export async function setMemberGroupsAction(slug: string, input: unknown): Promise<ActionResult> {
  try {
    const viewer = await groupViewer(slug);
    const parsed = userGroupsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setUserGroups(getDb(), viewer, parsed.data.userId, parsed.data.groupIds);
    revalidatePath(`/w/${slug}/team`);
    return ok(undefined);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
