"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * Whose entries a tracker page shows and edits: the viewer's own (null), or a
 * person an admin or manager may add time for (decision 8). Pages set it from
 * `?user=`; the entry queries, caches and mutations read it, so another
 * person's week never lands under the viewer's own keys. The timer bar never
 * reads it: timers are always the viewer's.
 */
export interface Target {
  userId: string;
  name: string;
}

const TargetContext = createContext<Target | null>(null);

export function TargetProvider({
  target,
  children,
}: {
  target: Target | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => (target ? { userId: target.userId, name: target.name } : null),
    [target],
  );
  return <TargetContext.Provider value={value}>{children}</TargetContext.Provider>;
}

export function useTarget(): Target | null {
  return useContext(TargetContext);
}

/** The query-key segment for the shown person: "me" or their id. */
export function useTargetKey(): string {
  return useTarget()?.userId ?? "me";
}
