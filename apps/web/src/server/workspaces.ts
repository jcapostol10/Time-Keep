import "server-only";

import { randomUUID } from "node:crypto";

import { type Role, slugify, uniqueSlug } from "@timekeep/core";
import { type Database, eq, membership, sql, workspace, workspaceSettings } from "@timekeep/db";

export interface CreateWorkspaceArgs {
  name: string;
  /** Becomes OWNER of the new workspace. */
  ownerId: string;
  timezone?: string;
}

/**
 * Single code path for creating a workspace: the row, its settings and the
 * owner membership, in one transaction. Used by the sign-up hook (personal
 * workspace) and the "New workspace" action.
 */
export async function createWorkspace(db: Database, args: CreateWorkspaceArgs) {
  return db.transaction(async (tx) => {
    const base = slugify(args.name);
    // Serialise slug allocation per base slug: without it, two sign-ups with
    // the same name read the same free slug and the second insert fails.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`workspace-slug:${base}`}))`);
    const taken = new Set(
      (await tx.select({ slug: workspace.slug }).from(workspace)).map((r) => r.slug),
    );
    const slug = uniqueSlug(base, (s) => taken.has(s));
    const id = randomUUID();

    const [created] = await tx
      .insert(workspace)
      .values({ id, name: args.name.trim(), slug })
      .returning();
    if (!created) throw new Error("Failed to create workspace");

    await tx.insert(workspaceSettings).values({
      workspaceId: id,
      timezone: args.timezone ?? "UTC",
    });

    await tx.insert(membership).values({
      id: randomUUID(),
      workspaceId: id,
      userId: args.ownerId,
      role: "owner" satisfies Role,
      status: "ACTIVE",
    });

    return created;
  });
}

/** Ensure a settings row exists (e.g. for workspaces created through Better Auth's endpoint). */
export async function ensureWorkspaceSettings(db: Database, workspaceId: string) {
  const existing = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, workspaceId),
  });
  if (!existing) {
    await db.insert(workspaceSettings).values({ workspaceId });
  }
}
