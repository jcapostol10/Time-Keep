import type { TimeEntryDTO } from "@/lib/tracker-types";

/**
 * Cross-tab sync for the running timer. Each tab posts what it changed; other
 * tabs update their cache so two tabs never show two running timers.
 * react-query's refetch-on-focus covers browsers without BroadcastChannel.
 */
export type TrackerMessage =
  | { type: "running"; running: TimeEntryDTO | null; sourceId: string }
  | { type: "entries-changed"; sourceId: string };

type Payload =
  | { type: "running"; running: TimeEntryDTO | null }
  | { type: "entries-changed" };

export interface TrackerChannel {
  post(message: Payload): void;
  close(): void;
}

export function createTrackerChannel(
  workspaceId: string,
  onMessage: (message: TrackerMessage) => void,
): TrackerChannel {
  if (typeof BroadcastChannel === "undefined") return { post() {}, close() {} };
  const sourceId = Math.random().toString(36).slice(2);
  const channel = new BroadcastChannel(`timekeep:tracker:${workspaceId}`);
  channel.onmessage = (event: MessageEvent<TrackerMessage>) => {
    if (event.data?.sourceId !== sourceId) onMessage(event.data);
  };
  return {
    post(message) {
      channel.postMessage({ ...message, sourceId });
    },
    close() {
      channel.close();
    },
  };
}
