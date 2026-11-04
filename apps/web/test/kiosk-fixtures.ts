import type { KioskInput } from "@timekeep/core";
import { type Database, project, task } from "@timekeep/db";

import { setUpTimeOffCast, type TimeOffCast } from "./time-off-fixtures";

/**
 * The Phase 5b cast plus two projects for kiosk tests: P (billable, task T)
 * and Q (task U).
 */
export interface KioskCast extends TimeOffCast {
  projectP: string;
  taskT: string;
  projectQ: string;
  taskU: string;
}

export async function setUpKioskCast(db: Database): Promise<KioskCast> {
  const cast = await setUpTimeOffCast(db);
  const ids = { projectP: "project-p", taskT: "task-t", projectQ: "project-q", taskU: "task-u" };
  await db.insert(project).values([
    { id: ids.projectP, workspaceId: cast.wsId, name: "P", color: "#0f766e", billable: true },
    { id: ids.projectQ, workspaceId: cast.wsId, name: "Q", color: "#0f766e", billable: false },
  ]);
  await db.insert(task).values([
    { id: ids.taskT, workspaceId: cast.wsId, projectId: ids.projectP, name: "T" },
    { id: ids.taskU, workspaceId: cast.wsId, projectId: ids.projectQ, name: "U" },
  ]);
  return { ...cast, ...ids };
}

/** "Front desk" for everyone, defaulting to project P without a task. */
export function frontDesk(cast: KioskCast, patch: Partial<KioskInput> = {}): KioskInput {
  return {
    name: "Front desk",
    projectId: cast.projectP,
    taskId: null,
    everyone: true,
    userIds: [],
    groupIds: [],
    sessionTimeoutSeconds: 15,
    showLogo: true,
    photo: false,
    ...patch,
  };
}
