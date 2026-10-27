import { randomUUID } from "node:crypto";

import { createDb, type Database, type DbHandle, membership, sql, user } from "@timekeep/db";

import { createWorkspace } from "@/server/workspaces";

import { assertSafeTestDatabaseUrl } from "./safe-test-db";

export function connectTestDb(): DbHandle {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  assertSafeTestDatabaseUrl(url);
  return createDb(url, { max: 2 });
}

/** Wipe every table between tests. Order does not matter thanks to CASCADE. */
export async function truncateAll(db: Database) {
  await db.execute(
    sql`TRUNCATE TABLE "rate_recalc_job", "rate", "invitation_group", "managed_group", "managed_user", "project_group", "user_group_member", "user_group", "export_job", "report_share_link", "captured_email", "timesheet_template", "time_entry_tag", "time_entry", "task_assignee", "task", "project_favorite", "project_member", "project", "client", "tag", "user_settings", "workspace_settings", "invitation", "membership", "workspace", "verification", "account", "session", "user" CASCADE`,
  );
}

export async function createTestUser(db: Database, name: string) {
  const id = randomUUID();
  const [row] = await db
    .insert(user)
    .values({
      id,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}.${id.slice(0, 8)}@test.local`,
      emailVerified: true,
    })
    .returning();
  if (!row) throw new Error("failed to create user");
  return row;
}

export async function createTestWorkspace(db: Database, name: string, ownerId: string) {
  return createWorkspace(db, { name, ownerId });
}

export async function addMember(
  db: Database,
  workspaceId: string,
  userId: string,
  role: "admin" | "manager" | "member",
  status: "ACTIVE" | "DEACTIVATED" = "ACTIVE",
) {
  await db.insert(membership).values({ id: randomUUID(), workspaceId, userId, role, status });
}
