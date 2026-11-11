import "server-only";

import type { Actor } from "@timekeep/core";
import { assignment, eq, inArray, or, sql } from "@timekeep/db";
import type { SQL } from "drizzle-orm";

/**
 * The two plans (Phase 7 design, decision 9), as SQL over `assignment`. Every
 * reader of assignments goes through one of them, so drafts and the rows they
 * replace are never counted twice.
 */

/** Drafts that are not tombstones, and published rows no draft replaces. */
export function workingPlanWhere(): SQL {
  return sql`((not ${assignment.published} and not ${assignment.deleted}) or (${assignment.published} and not exists (select 1 from "assignment" d where d."replaces_id" = ${assignment.id})))`;
}

/** What the people in it were told: published rows only. */
export function publishedPlanWhere(): SQL {
  return sql`${assignment.published}`;
}

/** Rows whose span, or any occurrence of their series, touches `[from, to]`. */
export function overlapsRange(from: string, to: string): SQL {
  return sql`(${assignment.startDate} <= ${to}::date and (case when ${assignment.repeatWeeks} is null then ${assignment.endDate} else ${assignment.repeatUntil} + (${assignment.endDate} - ${assignment.startDate}) end) >= ${from}::date)`;
}

/**
 * The rows `assignment.write` reaches: owners and admins everything, a
 * manager their own, their people's and anything on the projects they
 * manage, a member their own. Combine with the workspace filter.
 */
export function assignmentScopeFilter(actor: Actor): SQL | undefined {
  if (actor.role === "owner" || actor.role === "admin") return undefined;
  const parts: SQL[] = [eq(assignment.userId, actor.userId)];
  if (actor.role === "manager") {
    if (actor.managedUserIds.size > 0) {
      parts.push(inArray(assignment.userId, [...actor.managedUserIds]));
    }
    if (actor.managedProjectIds.size > 0) {
      parts.push(inArray(assignment.projectId, [...actor.managedProjectIds]));
    }
  }
  return parts.length === 1 ? parts[0] : or(...parts);
}
