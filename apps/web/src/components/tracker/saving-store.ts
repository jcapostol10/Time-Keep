"use client";

import { useSyncExternalStore } from "react";

/**
 * Counts entry saves still waiting for the server. The UI shows the optimistic
 * value immediately, so this is the only signal that a change has really been
 * stored: the tracker page exposes it as `data-saving`, and the browser warns
 * before leaving while it is non-zero (on Vercel an in-flight save can be lost
 * when the page unloads).
 */
let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Marks a save as started; call the returned function exactly once when it settles. */
export function beginSave(): () => void {
  pending += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending -= 1;
    emit();
  };
}

/** Runs `task` while counted as a pending save. */
export async function trackSave<T>(task: () => Promise<T>): Promise<T> {
  const end = beginSave();
  try {
    return await task();
  } finally {
    end();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsSaving(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending > 0,
    () => false,
  );
}
