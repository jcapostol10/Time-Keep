"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A string value in localStorage, safe for SSR (the server and the first
 * hydration render see `fallback`) and synced across tabs via `storage`.
 * Storage can be unavailable (private mode), so every access is guarded.
 */
const EVENT = "timekeep:local-storage";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(EVENT, listener);
  };
}

export function useLocalStorage<T extends string>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => (read(key) as T | null) ?? fallback,
    () => fallback,
  );
  const set = useCallback((next: T) => writeLocalStorage(key, next), [key]);
  return [value, set];
}
