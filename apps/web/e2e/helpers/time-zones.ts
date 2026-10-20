/**
 * Fresh users get the time zone where it is currently about noon, so a test
 * has at least 11 hours before local midnight. With a fixed zone, a run that
 * crossed midnight there put "today's" entries on two different days.
 *
 * One real city per whole-hour UTC offset, none of which observes daylight
 * saving (the app only accepts zones listed by Intl, which excludes Etc/GMT±N).
 */
const ZONE_BY_UTC_OFFSET: Record<number, string> = {
  [-11]: "Pacific/Pago_Pago",
  [-10]: "Pacific/Honolulu",
  [-9]: "Pacific/Gambier",
  [-8]: "Pacific/Pitcairn",
  [-7]: "America/Phoenix",
  [-6]: "America/Guatemala",
  [-5]: "America/Bogota",
  [-4]: "America/La_Paz",
  [-3]: "America/Sao_Paulo",
  [-2]: "America/Noronha",
  [-1]: "Atlantic/Cape_Verde",
  0: "Africa/Abidjan",
  1: "Africa/Lagos",
  2: "Africa/Johannesburg",
  3: "Africa/Nairobi",
  4: "Asia/Dubai",
  5: "Asia/Tashkent",
  6: "Asia/Dhaka",
  7: "Asia/Bangkok",
  8: "Asia/Manila",
  9: "Asia/Tokyo",
  10: "Australia/Brisbane",
  11: "Pacific/Noumea",
  12: "Pacific/Tarawa",
};

/** A zone whose local time at `now` is 12:xx. */
export function zoneNearNoon(now: Date = new Date()): string {
  const offset = 12 - now.getUTCHours(); // -11 … +12
  const zone = ZONE_BY_UTC_OFFSET[offset];
  if (!zone) throw new Error(`zoneNearNoon: no zone for UTC${offset >= 0 ? "+" : ""}${offset}`);
  return zone;
}
