import { localWeekday, minutesSinceMidnight } from "./time";

/**
 * Pure rules behind the browser-side tracker helpers (Pomodoro, reminders,
 * idle detection). The web app wires them to timers and browser APIs.
 */

export interface PomodoroState {
  phase: "focus" | "break";
  /** How many focus/break boundaries the timer has passed. */
  boundaries: number;
}

export function pomodoroState(
  elapsedSeconds: number,
  focusMinutes: number,
  breakMinutes: number,
): PomodoroState {
  const focus = focusMinutes * 60;
  const cycle = focus + breakMinutes * 60;
  const elapsed = Math.max(0, elapsedSeconds);
  const cycles = Math.floor(elapsed / cycle);
  const inBreak = elapsed - cycles * cycle >= focus;
  return { phase: inBreak ? "break" : "focus", boundaries: cycles * 2 + (inBreak ? 1 : 0) };
}

/** True when a "no timer running" reminder is due (caller checks that no timer runs). */
export function shouldRemind(args: {
  now: Date;
  tz: string;
  days: readonly number[];
  startMinutes: number;
  endMinutes: number;
  lastRemindedAt: Date | null;
  throttleMs: number;
}): boolean {
  const { now, tz } = args;
  if (!args.days.includes(localWeekday(now, tz))) return false;
  const minute = minutesSinceMidnight(now, tz);
  if (minute < args.startMinutes || minute >= args.endMinutes) return false;
  if (args.lastRemindedAt && now.getTime() - args.lastRemindedAt.getTime() < args.throttleMs) {
    return false;
  }
  return true;
}

/**
 * Fallback idle detection when the Idle Detection API is unavailable: the
 * user is idle since their last input once it is older than the threshold,
 * or since the last clock tick when the machine evidently slept.
 */
export function heuristicIdleSince(args: {
  now: Date;
  lastInputAt: Date;
  lastTickAt: Date;
  thresholdMs: number;
}): Date | null {
  const { now, lastInputAt, lastTickAt, thresholdMs } = args;
  if (now.getTime() - lastTickAt.getTime() >= thresholdMs) {
    return lastInputAt.getTime() < lastTickAt.getTime() ? lastInputAt : lastTickAt;
  }
  if (now.getTime() - lastInputAt.getTime() >= thresholdMs) return lastInputAt;
  return null;
}
