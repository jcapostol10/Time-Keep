"use server";

import { estimateInputSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { ProjectDetail } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import { catalogFailure } from "@/server/actions/errors";
import { authorizeProject } from "@/server/authz";
import { setProjectEstimate } from "@/server/budgets";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** A project's estimate (Phase 6b): owners, admins and the project's managers set it. */
export async function setProjectEstimateAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<ProjectDetail>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorizeProject(ctx, "project.update", projectId);
    const parsed = estimateInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const updated = await setProjectEstimate(getDb(), viewer, projectId, parsed.data);
    revalidatePath(workspaceRoutes.project(slug, projectId), "layout");
    revalidatePath(workspaceRoutes.projects(slug));
    return ok(updated);
  } catch (error) {
    return catalogFailure(error);
  }
}
