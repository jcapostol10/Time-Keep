import { randomUUID } from "node:crypto";

import type { AssignmentInput } from "@timekeep/core";
import { type Database, projectMember, task } from "@timekeep/db";

import { loadViewer } from "../src/server/authz";
import { createProject } from "../src/server/catalog/projects";
import { setUpTimeOffCast, type TimeOffCast } from "./time-off-fixtures";

/**
 * The Phase 7a cast: the Phase 5b one (Olga owner, Ann admin, Max manages Bob,
 * Bob in group Cebu; Asia/Manila, Monday weeks) with three projects. Website is
 * public and Max manages it; Mobile is public; Secret is private, Bob is on it.
 */
export interface ScheduleCast extends TimeOffCast {
  projects: { website: string; mobile: string; secret: string };
  /** A per-day assignment input for `who` on `projectId`, Mon 16 – Fri 20 Nov 2026, 4 h a day. */
  input: (
    who: keyof TimeOffCast["ids"],
    projectId: string,
    patch?: Partial<AssignmentInput>,
  ) => AssignmentInput;
  doneTask: (projectId: string) => Promise<string>;
}

/** Wednesday 11 November 2026, noon in Manila. */
export const NOW = new Date("2026-11-11T04:00:00.000Z");

export async function setUpScheduleCast(db: Database): Promise<ScheduleCast> {
  const cast = await setUpTimeOffCast(db);
  const owner = await loadViewer(db, cast.wsId, cast.ids.olga);
  const website = (await createProject(db, owner, { name: "Website" })).id;
  const mobile = (await createProject(db, owner, { name: "Mobile" })).id;
  const secret = (await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" })).id;
  await db.insert(projectMember).values([
    { projectId: website, userId: cast.ids.max, isManager: true },
    { projectId: secret, userId: cast.ids.bob, isManager: false },
  ]);
  const input: ScheduleCast["input"] = (who, projectId, patch = {}) => ({
    userId: cast.ids[who],
    projectId,
    taskId: null,
    startDate: "2026-11-16",
    endDate: "2026-11-20",
    mode: "PER_DAY",
    minutesPerDay: 240,
    totalMinutes: null,
    includeNonWorking: false,
    note: "",
    repeatWeeks: null,
    repeatUntil: null,
    ...patch,
  });
  const doneTask = async (projectId: string) => {
    const id = randomUUID();
    await db
      .insert(task)
      .values({ id, workspaceId: cast.wsId, projectId, name: "Old", status: "DONE" });
    return id;
  };
  return { ...cast, projects: { website, mobile, secret }, input, doneTask };
}
