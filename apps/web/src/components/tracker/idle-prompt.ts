/** An idle prompt belongs to the running entry it was raised for. */
export interface IdlePrompt {
  entryId: string;
  since: Date;
}

/**
 * The prompt to show now: only while the same timer is still running. A
 * prompt whose timer stopped (here or in another tab) or was replaced by a new
 * timer is dropped, so it can never cut a newer timer short.
 */
export function activeIdlePrompt(
  prompt: IdlePrompt | null,
  running: { id: string } | null,
): IdlePrompt | null {
  return prompt && running && prompt.entryId === running.id ? prompt : null;
}
