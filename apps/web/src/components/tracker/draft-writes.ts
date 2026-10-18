"use client";

/**
 * Picker work that will still change the timer bar's details when it finishes:
 * creating a project or tag selects it once the server replies. Start waits
 * for these, so a tag created a moment before Start is not left off the entry
 * (Next.js runs server actions one at a time, so on a slow connection the
 * create can finish after Start has already read the details).
 */
const inFlight = new Set<Promise<unknown>>();

/** Registers `task` until it settles and returns it unchanged. */
export function trackDraftWrite<T>(task: Promise<T>): Promise<T> {
  inFlight.add(task);
  task.then(
    () => inFlight.delete(task),
    () => inFlight.delete(task),
  );
  return task;
}

/** Resolves once every registered task has settled, including ones added meanwhile. */
export async function draftWritesSettled(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}
