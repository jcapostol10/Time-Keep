import "server-only";

import { randomUUID } from "node:crypto";

import { can, type MilestoneInput } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  type DbExecutor,
  eq,
  gte,
  inArray,
  lte,
  milestone,
  project,
} from "@timekeep/db";

import { WorkspaceAccessError } from "../access-error";
import { assertCan, projectResource } from "../authz";
import { visibleProjectFilter, type Viewer } from "../catalog/viewer";
import type { MilestoneDTO } from "@/lib/schedule-types";

/** Milestones (decision 16): a project's dates, managed by its managers, owners and admins. */

async function assertManages(db: DbExecutor, viewer: Viewer, projectId: string) {
  assertCan(viewer.actor, "milestone.manage", await projectResource(db, viewer, projectId));
}

async function load(db: DbExecutor, viewer: Viewer, id: string) {
  const [row] = await db
    .select()
    .from(milestone)
    .where(and(eq(milestone.id, id), eq(milestone.workspaceId, viewer.workspaceId)));
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  return row;
}

export async function createMilestone(
  db: Database,
  viewer: Viewer,
  input: MilestoneInput,
): Promise<string> {
  await assertManages(db, viewer, input.projectId);
  const id = randomUUID();
  await db.insert(milestone).values({
    id,
    workspaceId: viewer.workspaceId,
    projectId: input.projectId,
    date: input.date,
    name: input.name,
    createdBy: viewer.userId,
  });
  return id;
}

export async function updateMilestone(
  db: Database,
  viewer: Viewer,
  id: string,
  patch: Partial<MilestoneInput>,
): Promise<void> {
  const row = await load(db, viewer, id);
  await assertManages(db, viewer, row.projectId);
  if (patch.projectId && patch.projectId !== row.projectId) {
    await assertManages(db, viewer, patch.projectId);
  }
  await db
    .update(milestone)
    .set({
      ...(patch.projectId ? { projectId: patch.projectId } : {}),
      ...(patch.date ? { date: patch.date } : {}),
      ...(patch.name ? { name: patch.name } : {}),
    })
    .where(eq(milestone.id, id));
}

export async function deleteMilestone(db: Database, viewer: Viewer, id: string): Promise<void> {
  const row = await load(db, viewer, id);
  await assertManages(db, viewer, row.projectId);
  await db.delete(milestone).where(eq(milestone.id, id));
}

/** Milestones in `[from, to]` on projects the viewer may see, by date. */
export async function listMilestones(
  db: DbExecutor,
  viewer: Viewer,
  range: { from: string; to: string },
  projectIds?: readonly string[],
): Promise<MilestoneDTO[]> {
  if (projectIds && projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: milestone.id,
      projectId: milestone.projectId,
      date: milestone.date,
      name: milestone.name,
    })
    .from(milestone)
    .innerJoin(project, eq(project.id, milestone.projectId))
    .where(
      and(
        eq(milestone.workspaceId, viewer.workspaceId),
        gte(milestone.date, range.from),
        lte(milestone.date, range.to),
        visibleProjectFilter(viewer),
        projectIds ? inArray(milestone.projectId, [...projectIds]) : undefined,
      ),
    )
    .orderBy(asc(milestone.date), asc(milestone.name));
  return rows.map((r) => ({
    ...r,
    editable: can(viewer.actor, "milestone.manage", { kind: "project", projectId: r.projectId }),
  }));
}
