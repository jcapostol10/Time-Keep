import "server-only";

import { after } from "next/server";

import { getDb } from "@timekeep/db";

import { drainOutbox } from "./outbox";

/** Sends what the request enqueued once the response is out (decision 1). */
export function drainSoon(): void {
  after(async () => {
    try {
      await drainOutbox(getDb());
    } catch (error) {
      // The daily cron and the next request's drain pick the rows up again.
      console.error("[outbox] drain after the request failed", error);
    }
  });
}
