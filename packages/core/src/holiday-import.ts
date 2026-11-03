import Holidays from "date-holidays";

/**
 * Public holidays from the bundled `date-holidays` dataset (ISC code, CC BY 3.0
 * data: see docs/THIRD_PARTY.md). A subpath of its own
 * (`@timekeep/core/holiday-import`), imported by server code only, so the
 * dataset never reaches a client bundle. Nothing here favours one country
 * (decision 11).
 */

export interface DatasetHoliday {
  date: string;
  name: string;
  type: "public" | "bank" | "school" | "optional" | "observance";
  /** Islamic-calendar days: the proclaimed date may differ. */
  estimated: boolean;
}

export interface ImportCandidate extends DatasetHoliday {
  selected: boolean;
  /** The name already stored on that date, when it differs (renamed by an admin). */
  existingName: string | null;
}

export const HOLIDAY_ATTRIBUTION = "Holiday data: date-holidays (CC BY 3.0)";

const ISLAMIC_MONTHS = /Muharram|Safar|Rabi|Jumada|Rajab|Sha'ban|Ramadan|Shawwal|Dhu al-/;
const OPTIONAL_TYPES: ReadonlySet<string> = new Set(["optional", "observance", "bank"]);

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function listCountries(): { code: string; name: string }[] {
  const countries = new Holidays().getCountries("en") ?? {};
  return Object.entries(countries)
    .map(([code, name]) => ({ code, name }))
    .sort(byName);
}

export function listRegions(country: string): { code: string; name: string }[] {
  const states = new Holidays().getStates(country, "en") ?? {};
  return Object.entries(states)
    .map(([code, name]) => ({ code, name }))
    .sort(byName);
}

let timezoneIndex: Map<string, string> | null = null;

/** The first country whose dataset lists the timezone; null for UTC and the like. */
export function countryForTimezone(tz: string): string | null {
  if (!timezoneIndex) {
    timezoneIndex = new Map();
    for (const code of Object.keys(new Holidays().getCountries("en") ?? {})) {
      for (const zone of new Holidays(code).getTimezones() ?? []) {
        if (!timezoneIndex.has(zone)) timezoneIndex.set(zone, code);
      }
    }
  }
  return timezoneIndex.get(tz) ?? null;
}

export function datasetHolidays(
  country: string,
  region: string | null,
  year: number,
  opts: { includeOptional: boolean },
): DatasetHoliday[] {
  const hd = region ? new Holidays(country, region) : new Holidays(country);
  const seen = new Set<string>();
  const out: DatasetHoliday[] = [];
  for (const h of hd.getHolidays(year, "en") ?? []) {
    if (h.type !== "public" && !(opts.includeOptional && OPTIONAL_TYPES.has(h.type))) continue;
    // The dataset's `date` is local wall time ("2027-03-09 00:00:00 -0600"): its date is the day.
    const date = h.date.slice(0, 10);
    const key = `${date}|${h.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, name: h.name, type: h.type, estimated: ISLAMIC_MONTHS.test(h.rule) });
  }
  return out;
}

/**
 * What an import would add: an exact (date, name) match is dropped; a row on
 * a date that already has another name (an admin renamed it) is offered
 * unticked, so the day is not doubled by accident.
 */
export function planHolidayImport(
  rows: readonly DatasetHoliday[],
  existing: readonly { date: string; name: string }[],
): ImportCandidate[] {
  const exact = new Set(existing.map((e) => `${e.date}|${e.name}`));
  const byDate = new Map(existing.map((e) => [e.date, e.name]));
  return rows
    .filter((r) => !exact.has(`${r.date}|${r.name}`))
    .map((r) => {
      const existingName = byDate.get(r.date) ?? null;
      return { ...r, selected: existingName === null, existingName };
    });
}
