import type { DurationFormat } from "./schemas";

/** Longest single entry the server accepts (999 hours). */
export const MAX_ENTRY_SECONDS = 999 * 3600;

const CLOCK_RE = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/;
const NUMBER_RE = /^\d+(?:[.,]\d+)?$/;
/** `1h30m`, `1h 30m`, `90m`, `2h`, `45s`, `1h2m3s` — units are required on every part. */
const UNITS_RE = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
/** `1h30` — hours followed by bare minutes. */
const HOURS_MINUTES_RE = /^(\d+(?:[.,]\d+)?)h(\d+)$/;

function toNumber(s: string): number {
  return Number(s.replace(",", "."));
}

/**
 * Parse a human duration into whole seconds.
 *
 * Accepted: `1:30`, `1:30:00` (h:mm[:ss]); bare numbers are hours (`2`, `1.5`,
 * `1,5`); unit forms `90m`, `1h30m`, `1h 30m`, `1h30`, `2h`, `45s`.
 * Returns null for anything else, for negatives and for more than 999 hours.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  let seconds: number | null = null;

  const clock = CLOCK_RE.exec(s);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    const sec = clock[3] === undefined ? 0 : Number(clock[3]);
    if (m > 59 || sec > 59) return null;
    seconds = h * 3600 + m * 60 + sec;
  } else if (NUMBER_RE.test(s)) {
    seconds = Math.round(toNumber(s) * 3600);
  } else {
    const hm = HOURS_MINUTES_RE.exec(s);
    const units = hm ?? UNITS_RE.exec(s);
    if (!units) return null;
    const [, h, m, sec] = units;
    if (h === undefined && m === undefined && sec === undefined) return null;
    seconds =
      Math.round((h ? toNumber(h) : 0) * 3600) + (m ? Number(m) : 0) * 60 + (sec ? Number(sec) : 0);
  }

  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_ENTRY_SECONDS) return null;
  return seconds;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Live clock / tab title: `0:42:10`. Hours are never padded and grow past 99. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** Render a duration in the workspace's chosen format. */
export function formatDuration(seconds: number, format: DurationFormat): string {
  const total = Math.max(0, Math.floor(seconds));
  switch (format) {
    case "hh:mm:ss":
      return formatClock(total);
    case "hh:mm": {
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      return `${h}:${pad(m)}`;
    }
    case "decimal":
      return (total / 3600).toFixed(2);
  }
}

export function computeDurationSeconds(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 1000);
}
