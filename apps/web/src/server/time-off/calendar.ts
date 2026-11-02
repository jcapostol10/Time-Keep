import "server-only";

import {
  can,
  dateKeysBetween,
  holidayApplies,
  holidayKeysFor,
  holidaysInRange,
  timeOffMinutesByDay,
} from "@timekeep/core";
import {
  and,
  type Database,
  eq,
  gte,
  inArray,
  lte,
  timeOffPolicy,
  timeOffRequest,
  user,
} from "@timekeep/db";

import type { TimeOffCalendarDTO } from "@/lib/time-off-types";

import { CatalogError } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { holidayRules } from "./holidays";
import { peopleContext, workspaceZone } from "./people";

/**
 * A month of who is away (approved and pending) among the people the viewer
 * may see (`timeOff.view`), and the holidays that apply to the viewer.
 */
export async function timeOffCalendar(
  db: Database,
  viewer: Viewer,
  month: string,
): Promise<TimeOffCalendarDTO> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new CatalogError("INVALID", "Pick a month");
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0));
  const last = `${month}-${String(lastDay.getUTCDate()).padStart(2, "0")}`;
  const zone = await workspaceZone(db, viewer.workspaceId);
  const people = [...(await peopleContext(db, zone)).values()].filter((p) =>
    can(viewer.actor, "timeOff.view", { kind: "person", userId: p.userId }),
  );
  const requests = people.length
    ? await db
        .select({
          userId: timeOffRequest.userId,
          userName: user.name,
          policyName: timeOffPolicy.name,
          unit: timeOffPolicy.unit,
          start: timeOffRequest.startDate,
          end: timeOffRequest.endDate,
          halfDay: timeOffRequest.halfDay,
          minutes: timeOffRequest.minutes,
          status: timeOffRequest.status,
        })
        .from(timeOffRequest)
        .innerJoin(user, eq(user.id, timeOffRequest.userId))
        .innerJoin(timeOffPolicy, eq(timeOffPolicy.id, timeOffRequest.policyId))
        .where(
          and(
            eq(timeOffRequest.workspaceId, viewer.workspaceId),
            inArray(
              timeOffRequest.userId,
              people.map((p) => p.userId),
            ),
            inArray(timeOffRequest.status, ["PENDING", "APPROVED"]),
            lte(timeOffRequest.startDate, last),
            gte(timeOffRequest.endDate, from),
          ),
        )
    : [];
  const ruleFrom = requests.reduce((m, r) => (r.start < m ? r.start : m), from);
  const ruleTo = requests.reduce((m, r) => (r.end > m ? r.end : m), last);
  const rules = await holidayRules(db, zone.id, ruleFrom, ruleTo);
  const byPerson = new Map(people.map((p) => [p.userId, p]));
  const away = new Map<string, TimeOffCalendarDTO["days"][number]["away"]>();
  for (const r of requests) {
    const person = byPerson.get(r.userId);
    if (!person) continue;
    const keys = holidayKeysFor(rules, person, r.start, r.end);
    const days = timeOffMinutesByDay(r.unit, r, person.capacity, keys);
    for (const dateKey of days.keys()) {
      away.set(dateKey, [
        ...(away.get(dateKey) ?? []),
        {
          userId: r.userId,
          userName: r.userName,
          policyName: r.policyName,
          halfDay: r.halfDay,
          status: r.status,
        },
      ]);
    }
  }
  const me = byPerson.get(viewer.userId) ??
    (await peopleContext(db, zone, [viewer.userId])).get(viewer.userId) ?? {
      userId: viewer.userId,
      groupIds: new Set<string>(),
    };
  const holidays = holidaysInRange(
    rules.filter((h) => holidayApplies(h, me)),
    from,
    last,
  );
  return {
    month,
    days: dateKeysBetween(from, last).map((dateKey) => ({
      dateKey,
      away: (away.get(dateKey) ?? []).sort((a, b) => a.userName.localeCompare(b.userName)),
      holidays: holidays.filter((h) => h.dateKey === dateKey).map((h) => h.holiday.name),
    })),
  };
}
