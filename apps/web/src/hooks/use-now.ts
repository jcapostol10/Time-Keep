"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared wall-clock that ticks on each whole second while anything is
 * subscribed. The server snapshot is 0 so hydration never mismatches; callers
 * treat 0 as "not mounted yet". Background tabs are throttled by the browser,
 * so the clock re-syncs when the tab becomes visible.
 */
const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  current = Date.now();
  for (const listener of listeners) listener();
}

function schedule() {
  timer = setTimeout(
    () => {
      emit();
      schedule();
    },
    1000 - (Date.now() % 1000) + 5,
  );
}

function onVisibility() {
  if (document.visibilityState === "visible") emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    }
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => 0;
const noopSubscribe = () => () => {};

/** Milliseconds since epoch, updated every second while `active`; 0 before hydration. */
export function useNow(active = true): number {
  return useSyncExternalStore(
    active ? subscribe : noopSubscribe,
    active ? getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
}
