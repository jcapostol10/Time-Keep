"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False during SSR and hydration, true once React owns the page. Exposed as
 * `data-hydrated` so e2e tests never type or press keys before handlers exist.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
