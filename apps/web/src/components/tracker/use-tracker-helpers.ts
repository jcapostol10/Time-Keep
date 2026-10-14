"use client";

import {
  heuristicIdleSince,
  pomodoroState,
  shouldRemind,
  type TrackerSettingsInput,
} from "@timekeep/core";
import { useEffect, useEffectEvent, useRef } from "react";

import { notify } from "@/lib/notifications";
import type { TimeEntryDTO } from "@/lib/tracker-types";

const REMINDER_THROTTLE_MS = 60 * 60_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** One notification per focus/break boundary of the running timer. */
export function usePomodoro(
  running: TimeEntryDTO | null,
  elapsedSeconds: number,
  settings: TrackerSettingsInput,
  ready: boolean,
) {
  const last = useRef<{ id: string; boundaries: number } | null>(null);
  useEffect(() => {
    if (!running || !settings.pomodoroEnabled || !ready) return;
    const state = pomodoroState(
      elapsedSeconds,
      settings.pomodoroFocusMinutes,
      settings.pomodoroBreakMinutes,
    );
    if (last.current?.id !== running.id) {
      // Don't replay boundaries that passed before this page loaded.
      last.current = { id: running.id, boundaries: state.boundaries };
      return;
    }
    if (state.boundaries > last.current.boundaries) {
      last.current.boundaries = state.boundaries;
      if (state.phase === "break") {
        notify("Focus block finished", {
          body: `Time for a ${settings.pomodoroBreakMinutes}-minute break.`,
          tag: "timekeep-pomodoro",
        });
      } else {
        notify("Break over", {
          body: `Back to ${running.description || "work"} for ${settings.pomodoroFocusMinutes} minutes.`,
          tag: "timekeep-pomodoro",
        });
      }
    }
  }, [running, elapsedSeconds, settings, ready]);
}

/** "No timer running" reminders during the user's working hours, at most hourly. */
export function useReminders(
  workspaceId: string,
  timezone: string,
  running: TimeEntryDTO | null,
  settings: TrackerSettingsInput,
  onClick: () => void,
) {
  const check = useEffectEvent(() => {
    const key = `timekeep:reminder:last:${workspaceId}`;
    let last: Date | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      last = raw ? new Date(Number(raw)) : null;
    } catch {
      // storage unavailable
    }
    const now = new Date();
    const due = shouldRemind({
      now,
      tz: timezone,
      days: settings.reminderDays,
      startMinutes: settings.reminderStartMinutes,
      endMinutes: settings.reminderEndMinutes,
      lastRemindedAt: last,
      throttleMs: REMINDER_THROTTLE_MS,
    });
    if (!due) return;
    try {
      window.localStorage.setItem(key, String(now.getTime()));
    } catch {
      // ignore
    }
    notify("No timer running", {
      body: "You are inside your working hours. Start tracking your time?",
      tag: "timekeep-reminder",
      onClick,
    });
  });

  const active = settings.remindersEnabled && !running;
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => check(), 5_000);
    const interval = setInterval(() => check(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
}

/**
 * Calls `onIdleReturn(idleSince)` when the user comes back after at least
 * `minutes` of idle time while enabled. Uses the Idle Detection API when the
 * user granted it; otherwise a last-input + visibility heuristic that also
 * catches a sleeping machine (a gap between clock ticks).
 */
export function useIdleDetection(
  enabled: boolean,
  minutes: number | null,
  onIdleReturn: (idleSince: Date) => void,
) {
  const fire = useEffectEvent((since: Date) => onIdleReturn(since));
  const thresholdMs = Math.max(60_000, (minutes ?? 0) * 60_000);

  useEffect(() => {
    if (!enabled || minutes === null) return;
    const controller = new AbortController();
    let idleSince: Date | null = null;
    let lastInputAt = new Date();
    let lastTickAt = new Date();
    let usingDetector = false;
    let lastMove = 0;

    const comeBack = () => {
      if (!idleSince) return;
      const since = idleSince;
      idleSince = null;
      fire(since);
    };

    const onInput = (event: Event) => {
      const now = Date.now();
      if (event.type === "pointermove" && now - lastMove < 1000) return;
      lastMove = now;
      if (!usingDetector) {
        const since = heuristicIdleSince({
          now: new Date(now),
          lastInputAt,
          lastTickAt,
          thresholdMs,
        });
        if (since && !idleSince) idleSince = since;
      }
      lastInputAt = new Date(now);
      lastTickAt = new Date(now);
      comeBack();
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || usingDetector) return;
      const since = heuristicIdleSince({ now: new Date(), lastInputAt, lastTickAt, thresholdMs });
      if (since && !idleSince) idleSince = since;
      // The prompt waits for the first input, which confirms the user is back.
    };

    const tick = setInterval(() => {
      if (usingDetector) return;
      const now = new Date();
      const since = heuristicIdleSince({ now, lastInputAt, lastTickAt, thresholdMs });
      if (since && !idleSince) idleSince = since;
      lastTickAt = now;
    }, 15_000);

    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, onInput, { passive: true, signal: controller.signal });
    }
    document.addEventListener("visibilitychange", onVisible, { signal: controller.signal });

    void (async () => {
      const Detector = window.IdleDetector;
      if (!Detector || !navigator.permissions) return;
      try {
        const status = await navigator.permissions.query({
          name: "idle-detection" as PermissionName,
        });
        if (status.state !== "granted" || controller.signal.aborted) return;
        const detector = new Detector();
        detector.addEventListener("change", () => {
          if (detector.userState === "idle") idleSince = new Date(Date.now() - thresholdMs);
          else if (detector.userState === "active") comeBack();
        });
        await detector.start({ threshold: thresholdMs, signal: controller.signal });
        usingDetector = true;
      } catch {
        // Fall back to the heuristic.
      }
    })();

    return () => {
      controller.abort();
      clearInterval(tick);
    };
  }, [enabled, minutes, thresholdMs]);
}
