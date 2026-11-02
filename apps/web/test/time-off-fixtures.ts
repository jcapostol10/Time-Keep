import {
  type Database,
  eq,
  managedUser,
  userGroup,
  userGroupMember,
  workspaceSettings,
} from "@timekeep/db";

import { loadViewer } from "../src/server/authz";
import type { Viewer } from "../src/server/catalog/viewer";
import { addMember, createTestUser, createTestWorkspace, truncateAll } from "./db";

/**
 * The Phase 5b cast, as in approvals.test.ts: Olga owns the workspace, Ann is
 * an admin, Max manages Bob, Bob is a member of the group "Cebu". The
 * workspace is in Asia/Manila with Monday weeks.
 */
export interface TimeOffCast {
  wsId: string;
  ids: { olga: string; ann: string; max: string; bob: string };
  cebuId: string;
  viewer: (who: keyof TimeOffCast["ids"]) => Promise<Viewer>;
  setRules: (patch: Partial<typeof workspaceSettings.$inferInsert>) => Promise<void>;
}

export async function setUpTimeOffCast(db: Database): Promise<TimeOffCast> {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const ann = await createTestUser(db, "Ann Admin");
  const max = await createTestUser(db, "Max Manager");
  const bob = await createTestUser(db, "Bob Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  await addMember(db, ws.id, ann.id, "admin");
  await addMember(db, ws.id, max.id, "manager");
  await addMember(db, ws.id, bob.id, "member");
  await db.insert(managedUser).values({ workspaceId: ws.id, managerId: max.id, userId: bob.id });
  const cebuId = "group-cebu";
  await db.insert(userGroup).values({ id: cebuId, workspaceId: ws.id, name: "Cebu" });
  await db.insert(userGroupMember).values({ groupId: cebuId, userId: bob.id });
  const setRules = async (patch: Partial<typeof workspaceSettings.$inferInsert>) => {
    await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, ws.id));
  };
  await setRules({ timezone: "Asia/Manila", weekStart: 1 });
  const ids = { olga: olga.id, ann: ann.id, max: max.id, bob: bob.id };
  return { wsId: ws.id, ids, cebuId, viewer: (who) => loadViewer(db, ws.id, ids[who]), setRules };
}
