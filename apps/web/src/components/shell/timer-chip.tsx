"use client";

import { formatClock } from "@timekeep/core";
import Link from "next/link";

import { useHydrated } from "@/hooks/use-hydrated";
import { workspaceRoutes } from "@/lib/routes";

import { useTracker, useTrackerClock } from "../tracker/tracker-provider";

/**
 * The running timer, in the top bar of every workspace page: its clock and
 * what it is for, in the live colour, linking back to the tracker. It reads
 * the timer `TrackerProvider` already holds (no request of its own) and is
 * the only part of the shell that follows the ticking clock, so the frame
 * does not re-render every second. Nothing shows while no timer runs.
 */
export function TimerChip({ slug }: { slug: string }) {
  const { running } = useTracker();
  const hydrated = useHydrated();
  // Before hydration the server and the browser must render the same thing: nothing.
  if (!hydrated || !running) return null;
  return <Chip slug={slug} description={running.description} />;
}

function Chip({ slug, description }: { slug: string; description: string }) {
  const { elapsedSeconds } = useTrackerClock();
  const what = description.trim() || "(no description)";
  return (
    <Link
      href={workspaceRoutes.tracker(slug)}
      aria-label={`Timer running: ${formatClock(elapsedSeconds)}, ${what}`}
      className="bg-live text-live-foreground text-meta flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium"
    >
      <span className="tabular-nums">{formatClock(elapsedSeconds)}</span>
      <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
        <span aria-hidden>·</span>
        <span className="max-w-48 truncate">{what}</span>
      </span>
    </Link>
  );
}
