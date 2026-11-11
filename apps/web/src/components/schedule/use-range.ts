"use client";

import { dateKeysBetween } from "@timekeep/core";
import { useMemo, useState } from "react";

import { rangeFor, shiftFrom, startFor, type Zoom } from "./schedule-model";

/**
 * The schedule's range state: a start and a zoom, mirrored into the URL with
 * `replaceState` (no server render), so a reload or a shared link opens the
 * same weeks.
 */
export function useScheduleRange(opts: {
  from: string;
  zoom: Zoom;
  today: string;
  weekStart: number;
}) {
  const [state, setState] = useState({ from: opts.from, zoom: opts.zoom });
  const range = useMemo(() => rangeFor(state.from, state.zoom), [state]);
  const days = useMemo(() => dateKeysBetween(range.from, range.to), [range]);

  function go(next: { from: string; zoom: Zoom }) {
    setState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("from", next.from);
    url.searchParams.set("zoom", next.zoom);
    window.history.replaceState(window.history.state, "", url);
  }

  return {
    zoom: state.zoom,
    range,
    days,
    shift: (direction: 1 | -1) =>
      go({ from: shiftFrom(state.from, state.zoom, direction), zoom: state.zoom }),
    today: () => go({ from: startFor(opts.today, state.zoom, opts.weekStart), zoom: state.zoom }),
    setZoom: (zoom: Zoom) => go({ from: startFor(state.from, zoom, opts.weekStart), zoom }),
  };
}
