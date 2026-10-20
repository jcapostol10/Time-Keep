/**
 * Extension point for external calendars (Google, Outlook). A later phase
 * registers sources here; the grid renders what they return as read-only
 * grey blocks. No OAuth or sync lives in Phase 2.
 */

export interface ExternalEvent {
  id: string;
  title: string;
  /** ISO instants */
  start: string;
  end: string;
  /** Which source produced it, e.g. "google". */
  source: string;
}

export interface ExternalEventSource {
  id: string;
  load(range: { from: Date; to: Date }): Promise<ExternalEvent[]>;
}

export const externalEventSources: ExternalEventSource[] = [];

/** Events from every registered source for the range, failures ignored per source. */
export async function loadExternalEvents(range: {
  from: Date;
  to: Date;
}): Promise<ExternalEvent[]> {
  const results = await Promise.allSettled(externalEventSources.map((s) => s.load(range)));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
