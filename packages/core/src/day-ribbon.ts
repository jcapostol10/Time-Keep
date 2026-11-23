import { blockOnDay, MINUTES_PER_DAY } from "./calendar";
import { formatDuration } from "./duration";
import type { DurationFormat, TimeFormat } from "./schemas";
import { addDaysInZone, formatTimeOfDay, zonedDateTimeToInstant } from "./time";

/**
 * The day ribbon: one day, 00:00 to 24:00 in the viewer's timezone, as a
 * strip with a block per entry. Positions are wall-clock shares of the day,
 * as on the calendar, so 12:00 is the middle of the strip on a 23- or 25-hour
 * day too; `seconds` is real time. Pure: the UI turns shares into widths.
 */

export interface RibbonEntry {
  id: string;
  start: string;
  /** Null while the timer runs: the block ends at `now`. */
  end: string | null;
}

export interface RibbonBlock {
  id: string;
  /** Percent of the day from its midnight, 0 to 100, to three decimals. */
  left: number;
  width: number;
  /** The part of the entry inside this day, as instants. */
  from: string;
  to: string;
  /** Real seconds inside this day. */
  seconds: number;
  running: boolean;
  /** The entry started before this day. */
  clippedStart: boolean;
  /** The entry ends (or is still running) after this day. */
  clippedEnd: boolean;
}

const share = (minutes: number) => Math.round((minutes / MINUTES_PER_DAY) * 100_000) / 1_000;

/** The blocks of the entries that touch `dayKey`, earliest first. An entry with no length has none. */
export function ribbonBlocks(
  entries: readonly RibbonEntry[],
  dayKey: string,
  tz: string,
  now: Date,
): RibbonBlock[] {
  const dayStart = zonedDateTimeToInstant({ date: dayKey, hours: 0, minutes: 0 }, tz);
  const dayEnd = addDaysInZone(dayStart, 1, tz);
  const blocks: RibbonBlock[] = [];
  for (const entry of entries) {
    const start = new Date(entry.start);
    const end = entry.end === null ? now : new Date(entry.end);
    if (end <= start) continue;
    // Most entries are not on this day: say so before any timezone maths.
    if (end <= dayStart || start >= dayEnd) continue;
    const block = blockOnDay({ start: entry.start, end: end.toISOString() }, dayKey, tz);
    if (!block) continue;
    const from = block.clippedStart ? dayStart : start;
    const to = block.clippedEnd ? dayEnd : end;
    blocks.push({
      id: entry.id,
      left: share(block.top),
      width: share(block.height),
      from: from.toISOString(),
      to: to.toISOString(),
      seconds: Math.round((to.getTime() - from.getTime()) / 1000),
      running: entry.end === null,
      clippedStart: block.clippedStart,
      clippedEnd: block.clippedEnd,
    });
  }
  return blocks.sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));
}

/** The ribbon in words, for people who do not see it: "6 entries, 7:30 tracked between 08:10 and 18:40". */
export function ribbonSummary(
  blocks: readonly RibbonBlock[],
  tz: string,
  formats: { durationFormat: DurationFormat; timeFormat: TimeFormat },
): string {
  const first = blocks[0];
  if (!first) return "No entries";
  const seconds = blocks.reduce((sum, b) => sum + b.seconds, 0);
  const from = blocks.reduce((min, b) => (b.from < min ? b.from : min), first.from);
  const to = blocks.reduce((max, b) => (b.to > max ? b.to : max), first.to);
  const time = (iso: string) => formatTimeOfDay(new Date(iso), tz, formats.timeFormat);
  const count = blocks.length === 1 ? "1 entry" : `${blocks.length} entries`;
  const running = blocks.some((b) => b.running) ? ", timer running" : "";
  return `${count}, ${formatDuration(seconds, formats.durationFormat)} tracked between ${time(from)} and ${time(to)}${running}`;
}
