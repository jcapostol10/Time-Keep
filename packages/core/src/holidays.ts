/**
 * Holidays (Phase 5b, decision 11). Nothing here is specific to a country: a
 * holiday is a date and a name for the whole workspace, or for the users and
 * groups it is assigned to. A yearly holiday repeats on its month and day from
 * its own year on; 29 February only in leap years.
 */

export interface HolidayRule {
  id: string;
  date: string;
  name: string;
  repeatsYearly: boolean;
  userIds: readonly string[];
  groupIds: readonly string[];
}

export interface HolidayPerson {
  userId: string;
  groupIds: ReadonlySet<string>;
}

/** No assignees → everyone. */
export function holidayApplies(h: HolidayRule, person: HolidayPerson): boolean {
  if (h.userIds.length === 0 && h.groupIds.length === 0) return true;
  return h.userIds.includes(person.userId) || h.groupIds.some((g) => person.groupIds.has(g));
}

function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** The dates in `[from, to]` on which each holiday falls, sorted by date. */
export function holidaysInRange(
  hs: readonly HolidayRule[],
  from: string,
  to: string,
): { dateKey: string; holiday: HolidayRule }[] {
  const out: { dateKey: string; holiday: HolidayRule }[] = [];
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (const h of hs) {
    if (!h.repeatsYearly) {
      if (h.date >= from && h.date <= to) out.push({ dateKey: h.date, holiday: h });
      continue;
    }
    const firstYear = Number(h.date.slice(0, 4));
    const month = Number(h.date.slice(5, 7));
    const day = Number(h.date.slice(8, 10));
    for (let y = Math.max(fromYear, firstYear); y <= toYear; y += 1) {
      if (!isValidDate(y, month, day)) continue;
      const key = `${y}${h.date.slice(4)}`;
      if (key >= from && key <= to) out.push({ dateKey: key, holiday: h });
    }
  }
  return out.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

export function holidayKeysFor(
  hs: readonly HolidayRule[],
  person: HolidayPerson,
  from: string,
  to: string,
): Set<string> {
  return new Set(
    holidaysInRange(
      hs.filter((h) => holidayApplies(h, person)),
      from,
      to,
    ).map((x) => x.dateKey),
  );
}
