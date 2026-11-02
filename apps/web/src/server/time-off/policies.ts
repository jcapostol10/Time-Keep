import "server-only";

import { randomUUID } from "node:crypto";

import { can, localDateKey, parseCenti, type TimeOffPolicyInput } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  type DbExecutor,
  eq,
  inArray,
  isNull,
  membership,
  timeOffPolicy,
  timeOffPolicyAssignee,
  timeOffRequest,
  userGroup,
} from "@timekeep/db";

import type { PolicyDTO } from "@/lib/time-off-types";

import { WorkspaceAccessError } from "../access-error";
import { assertCan } from "../authz";
import { CatalogError, isUniqueViolation } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import type { PersonContext, WorkspaceZone } from "./people";

type PolicyRow = typeof timeOffPolicy.$inferSelect;
type AssigneeRow = { userId: string | null; groupId: string | null; createdAt: Date };

function toDTO(p: PolicyRow, assignees: AssigneeRow[], withAssignees: boolean): PolicyDTO {
  return {
    id: p.id,
    name: p.name,
    unit: p.unit,
    accrual: p.accrual,
    allowanceCenti: p.allowanceCenti,
    allowNegative: p.allowNegative,
    requiresApproval: p.requiresApproval,
    everyone: p.everyone,
    userIds: withAssignees ? assignees.flatMap((a) => (a.userId ? [a.userId] : [])) : [],
    groupIds: withAssignees ? assignees.flatMap((a) => (a.groupId ? [a.groupId] : [])) : [],
    archived: p.archivedAt !== null,
  };
}

async function assigneesOf(db: DbExecutor, policyIds: string[]) {
  const rows = policyIds.length
    ? await db
        .select({
          policyId: timeOffPolicyAssignee.policyId,
          userId: timeOffPolicyAssignee.userId,
          groupId: timeOffPolicyAssignee.groupId,
          createdAt: timeOffPolicyAssignee.createdAt,
        })
        .from(timeOffPolicyAssignee)
        .where(inArray(timeOffPolicyAssignee.policyId, policyIds))
    : [];
  const out = new Map<string, AssigneeRow[]>();
  for (const r of rows) out.set(r.policyId, [...(out.get(r.policyId) ?? []), r]);
  return out;
}

/** When a policy reached the person: its creation for everyone, else their earliest assignee row. */
function assignedAt(p: PolicyRow, assignees: AssigneeRow[], person: PersonContext): Date | null {
  if (p.everyone) return p.createdAt;
  const mine = assignees.filter(
    (a) =>
      (a.userId !== null && a.userId === person.userId) ||
      (a.groupId !== null && person.groupIds.has(a.groupId)),
  );
  if (mine.length === 0) return null;
  return new Date(Math.min(...mine.map((a) => a.createdAt.getTime())));
}

/** A policy assigned to a person, with the date their balance starts (ruling R1). */
export interface AssignedPolicy {
  policy: PolicyRow;
  /** The later of the join date and the assignment date, in the workspace timezone. */
  startedOn: string;
}

/** The active policies assigned to each person (everyone, their user, or one of their groups). */
export async function policiesFor(
  db: DbExecutor,
  zone: WorkspaceZone,
  people: readonly PersonContext[],
  opts: { includeArchived?: boolean } = {},
): Promise<Map<string, AssignedPolicy[]>> {
  const policies = await db
    .select()
    .from(timeOffPolicy)
    .where(
      and(
        eq(timeOffPolicy.workspaceId, zone.id),
        opts.includeArchived ? undefined : isNull(timeOffPolicy.archivedAt),
      ),
    )
    .orderBy(asc(timeOffPolicy.name));
  const assignees = await assigneesOf(
    db,
    policies.map((p) => p.id),
  );
  const out = new Map<string, AssignedPolicy[]>();
  for (const person of people) {
    const list: AssignedPolicy[] = [];
    for (const p of policies) {
      const at = assignedAt(p, assignees.get(p.id) ?? [], person);
      if (!at) continue;
      const assignedOn = localDateKey(at, zone.timezone);
      list.push({
        policy: p,
        startedOn: assignedOn > person.joinedOn ? assignedOn : person.joinedOn,
      });
    }
    out.set(person.userId, list);
  }
  return out;
}

/** Admins see every policy; everyone else the active ones assigned to them. */
export async function listPolicies(
  db: Database,
  viewer: Viewer,
  opts: { includeArchived?: boolean } = {},
): Promise<PolicyDTO[]> {
  const manages = can(viewer.actor, "timeOff.manage", { kind: "none" });
  const rows = await db
    .select()
    .from(timeOffPolicy)
    .where(
      and(
        eq(timeOffPolicy.workspaceId, viewer.workspaceId),
        manages && opts.includeArchived ? undefined : isNull(timeOffPolicy.archivedAt),
      ),
    )
    .orderBy(asc(timeOffPolicy.name));
  const assignees = await assigneesOf(
    db,
    rows.map((p) => p.id),
  );
  if (manages) return rows.map((p) => toDTO(p, assignees.get(p.id) ?? [], true));
  const groups = await db.query.userGroupMember.findMany({
    where: (m, { eq: e }) => e(m.userId, viewer.userId),
    columns: { groupId: true },
  });
  const me = { userId: viewer.userId, groupIds: new Set(groups.map((g) => g.groupId)) };
  return rows
    .filter((p) => assignedAt(p, assignees.get(p.id) ?? [], me as PersonContext) !== null)
    .map((p) => toDTO(p, [], false));
}

async function assertAssignees(db: DbExecutor, workspaceId: string, input: TimeOffPolicyInput) {
  await assertPeopleAndGroups(db, workspaceId, input.userIds, input.groupIds);
}

/** Every user is a member of the workspace and every group is one of its groups. */
export async function assertPeopleAndGroups(
  db: DbExecutor,
  workspaceId: string,
  userIds: readonly string[],
  groupIds: readonly string[],
): Promise<void> {
  if (userIds.length) {
    const found = await db
      .select({ userId: membership.userId })
      .from(membership)
      .where(
        and(eq(membership.workspaceId, workspaceId), inArray(membership.userId, [...userIds])),
      );
    if (found.length !== new Set(userIds).size) {
      throw new CatalogError("INVALID", "Pick people from this workspace.");
    }
  }
  if (groupIds.length) {
    const found = await db
      .select({ id: userGroup.id })
      .from(userGroup)
      .where(and(eq(userGroup.workspaceId, workspaceId), inArray(userGroup.id, [...groupIds])));
    if (found.length !== new Set(groupIds).size) {
      throw new CatalogError("INVALID", "Pick groups from this workspace.");
    }
  }
}

/**
 * What to change so a parent's assignee rows match `want`, by difference, so a
 * row that stays keeps its `created_at` (a MONTHLY balance starts from it).
 */
export function assigneeDiff(
  current: readonly { id: string; userId: string | null; groupId: string | null }[],
  want: { userIds: readonly string[]; groupIds: readonly string[] },
): { dropIds: string[]; add: { userId: string | null; groupId: string | null }[] } {
  const users = new Set(want.userIds);
  const groups = new Set(want.groupIds);
  const dropIds = current
    .filter((r) => (r.userId ? !users.has(r.userId) : !groups.has(r.groupId ?? "")))
    .map((r) => r.id);
  const haveUsers = new Set(current.flatMap((r) => (r.userId ? [r.userId] : [])));
  const haveGroups = new Set(current.flatMap((r) => (r.groupId ? [r.groupId] : [])));
  return {
    dropIds,
    add: [
      ...[...users].filter((u) => !haveUsers.has(u)).map((userId) => ({ userId, groupId: null })),
      ...[...groups]
        .filter((g) => !haveGroups.has(g))
        .map((groupId) => ({ userId: null, groupId })),
    ],
  };
}

async function replacePolicyAssignees(
  tx: DbExecutor,
  policyId: string,
  want: { userIds: readonly string[]; groupIds: readonly string[] },
): Promise<void> {
  const t = timeOffPolicyAssignee;
  const current = await tx
    .select({ id: t.id, userId: t.userId, groupId: t.groupId })
    .from(t)
    .where(eq(t.policyId, policyId));
  const { dropIds, add } = assigneeDiff(current, want);
  if (dropIds.length) await tx.delete(t).where(inArray(t.id, dropIds));
  if (add.length) await tx.insert(t).values(add.map((a) => ({ id: randomUUID(), policyId, ...a })));
}

export async function savePolicy(
  db: Database,
  viewer: Viewer,
  input: TimeOffPolicyInput,
  id?: string,
): Promise<PolicyDTO> {
  assertCan(viewer.actor, "timeOff.manage", { kind: "none" });
  const allowanceCenti = input.allowance === "" ? 0 : (parseCenti(input.allowance) ?? 0);
  const values = {
    name: input.name,
    unit: input.unit,
    accrual: input.accrual,
    allowanceCenti: input.accrual === "NONE" ? 0 : allowanceCenti,
    allowNegative: input.allowNegative,
    requiresApproval: input.requiresApproval,
    everyone: input.everyone,
  };
  try {
    const policyId = await db.transaction(async (tx) => {
      await assertAssignees(tx, viewer.workspaceId, input);
      let policyId = id;
      if (policyId) {
        const [existing] = await tx
          .select({ unit: timeOffPolicy.unit })
          .from(timeOffPolicy)
          .where(
            and(eq(timeOffPolicy.id, policyId), eq(timeOffPolicy.workspaceId, viewer.workspaceId)),
          );
        if (!existing) throw new WorkspaceAccessError(404, "Not found");
        if (existing.unit !== input.unit) {
          const [used] = await tx
            .select({ id: timeOffRequest.id })
            .from(timeOffRequest)
            .where(eq(timeOffRequest.policyId, policyId))
            .limit(1);
          if (used) {
            throw new CatalogError(
              "INVALID",
              "The unit cannot change once time off was requested.",
            );
          }
        }
        await tx.update(timeOffPolicy).set(values).where(eq(timeOffPolicy.id, policyId));
      } else {
        policyId = randomUUID();
        await tx
          .insert(timeOffPolicy)
          .values({ id: policyId, workspaceId: viewer.workspaceId, ...values });
      }
      await replacePolicyAssignees(
        tx,
        policyId,
        input.everyone ? { userIds: [], groupIds: [] } : input,
      );
      return policyId;
    });
    const dto = (await listPolicies(db, viewer, { includeArchived: true })).find(
      (p) => p.id === policyId,
    );
    if (!dto) throw new WorkspaceAccessError(404, "Not found");
    return dto;
  } catch (error) {
    if (isUniqueViolation(error, "time_off_policy_workspace_name_uq")) {
      throw new CatalogError("CONFLICT", "A policy with this name already exists.");
    }
    throw error;
  }
}

export async function archivePolicy(
  db: Database,
  viewer: Viewer,
  id: string,
  archived: boolean,
): Promise<void> {
  assertCan(viewer.actor, "timeOff.manage", { kind: "none" });
  const rows = await db
    .update(timeOffPolicy)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(timeOffPolicy.id, id), eq(timeOffPolicy.workspaceId, viewer.workspaceId)))
    .returning({ id: timeOffPolicy.id });
  if (rows.length === 0) throw new WorkspaceAccessError(404, "Not found");
}

/** One policy of the workspace, or 404. */
export async function loadPolicy(db: DbExecutor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(timeOffPolicy)
    .where(and(eq(timeOffPolicy.id, id), eq(timeOffPolicy.workspaceId, workspaceId)));
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  return row;
}
