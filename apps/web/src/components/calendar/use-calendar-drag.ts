"use client";

import { MINUTES_PER_DAY, SLOT_MINUTES, snapMinutes } from "@timekeep/core";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import type { TimeEntryDTO } from "@/lib/tracker-types";

const SLOT_PX = 16;
const CLICK_TOLERANCE_PX = 4;

export interface Ghost {
  dayKey: string;
  top: number;
  height: number;
  label: string;
}

type Drag =
  | { kind: "create"; dayKey: string; fromMinutes: number; originY: number; originX: number }
  | {
      kind: "move";
      entry: TimeEntryDTO;
      grabOffset: number;
      height: number;
      originY: number;
      originX: number;
    }
  | {
      kind: "resize";
      entry: TimeEntryDTO;
      edge: "start" | "end";
      dayKey: string;
      originY: number;
      originX: number;
    };

function minutesAt(column: HTMLElement, clientY: number): number {
  const rect = column.getBoundingClientRect();
  return Math.min(MINUTES_PER_DAY, Math.max(0, ((clientY - rect.top) / SLOT_PX) * SLOT_MINUTES));
}

function columnAt(clientX: number, clientY: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el instanceof HTMLElement && el.dataset.day !== undefined) return el;
  }
  return null;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Pointer handling for the grid: drag on empty space creates, drag a block
 * moves it (across days in week view), drag an edge resizes, a click edits.
 * The maths of what a drag means lives in core; this only tracks pointers.
 */
export function useCalendarDrag({
  entries,
  onCreate,
  onMove,
  onResize,
  onEdit,
}: {
  entries: TimeEntryDTO[];
  onCreate: (dayKey: string, a: number, b: number) => void;
  onMove: (entry: TimeEntryDTO, dayKey: string, startMinutes: number) => void;
  onResize: (entry: TimeEntryDTO, edge: "start" | "end", dayKey: string, minutes: number) => void;
  onEdit: (entry: TimeEntryDTO) => void;
}) {
  const dragRef = useRef<Drag | null>(null);
  const movedRef = useRef(false);
  const [ghost, setGhostState] = useState<Ghost | null>(null);
  // Pointer moves are batched, so the drop reads the latest ghost from a ref.
  const ghostRef = useRef<Ghost | null>(null);
  const setGhost = (next: Ghost | null) => {
    ghostRef.current = next;
    setGhostState(next);
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const column = target.closest<HTMLElement>("[data-day]");
    if (!column) return;
    const dayKey = column.dataset.day!;
    const minutes = minutesAt(column, e.clientY);
    const blockEl = target.closest<HTMLElement>("[data-entry-id]");
    if (target.closest("[data-running]")) return;
    movedRef.current = false;
    if (blockEl) {
      const entry = entries.find((x) => x.id === blockEl.dataset.entryId);
      if (!entry) return;
      const handle = target.closest<HTMLElement>("[data-resize]");
      if (handle) {
        dragRef.current = {
          kind: "resize",
          entry,
          edge: handle.dataset.resize === "start" ? "start" : "end",
          dayKey,
          originY: e.clientY,
          originX: e.clientX,
        };
      } else {
        const rect = blockEl.getBoundingClientRect();
        const colRect = column.getBoundingClientRect();
        const top = ((rect.top - colRect.top) / SLOT_PX) * SLOT_MINUTES;
        dragRef.current = {
          kind: "move",
          entry,
          grabOffset: minutes - top,
          height: (rect.height / SLOT_PX) * SLOT_MINUTES,
          originY: e.clientY,
          originX: e.clientX,
        };
      }
    } else {
      dragRef.current = {
        kind: "create",
        dayKey,
        fromMinutes: minutes,
        originY: e.clientY,
        originX: e.clientX,
      };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (
      Math.abs(e.clientY - drag.originY) > CLICK_TOLERANCE_PX ||
      Math.abs(e.clientX - drag.originX) > CLICK_TOLERANCE_PX
    ) {
      movedRef.current = true;
    }
    if (!movedRef.current) return;
    const column = columnAt(e.clientX, e.clientY);
    if (drag.kind === "create") {
      const col = document.querySelector<HTMLElement>(`[data-day="${drag.dayKey}"]`);
      if (!col) return;
      const to = snapMinutes(minutesAt(col, e.clientY));
      const from = snapMinutes(drag.fromMinutes);
      const top = Math.min(from, to);
      const height = Math.max(Math.abs(to - from), SLOT_MINUTES);
      setGhost({
        dayKey: drag.dayKey,
        top,
        height,
        label: `${formatMinutes(top)} – ${formatMinutes(top + height)}`,
      });
    } else if (drag.kind === "move") {
      if (!column) return;
      const top = snapMinutes(minutesAt(column, e.clientY) - drag.grabOffset);
      setGhost({
        dayKey: column.dataset.day!,
        top: Math.min(top, MINUTES_PER_DAY - drag.height),
        height: drag.height,
        label: drag.entry.description || "(no description)",
      });
    } else {
      const col = document.querySelector<HTMLElement>(`[data-day="${drag.dayKey}"]`);
      if (!col) return;
      const minutes = snapMinutes(minutesAt(col, e.clientY));
      const blockEl = col.querySelector<HTMLElement>(`[data-entry-id="${drag.entry.id}"]`);
      if (!blockEl) return;
      const rect = blockEl.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      const top = ((rect.top - colRect.top) / SLOT_PX) * SLOT_MINUTES;
      const bottom = ((rect.bottom - colRect.top) / SLOT_PX) * SLOT_MINUTES;
      const newTop = drag.edge === "start" ? Math.min(minutes, bottom - SLOT_MINUTES) : top;
      const newBottom = drag.edge === "end" ? Math.max(minutes, top + SLOT_MINUTES) : bottom;
      setGhost({
        dayKey: drag.dayKey,
        top: newTop,
        height: newBottom - newTop,
        label: `${formatMinutes(newTop)} – ${formatMinutes(newBottom)}`,
      });
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    const finalGhost = ghostRef.current;
    setGhost(null);
    if (!drag) return;
    if (!movedRef.current) {
      if (drag.kind === "move") onEdit(drag.entry);
      return;
    }
    if (drag.kind === "create") {
      const col = document.querySelector<HTMLElement>(`[data-day="${drag.dayKey}"]`);
      if (!col) return;
      onCreate(drag.dayKey, drag.fromMinutes, minutesAt(col, e.clientY));
    } else if (drag.kind === "move") {
      if (!finalGhost) return;
      onMove(drag.entry, finalGhost.dayKey, finalGhost.top);
    } else {
      const col = document.querySelector<HTMLElement>(`[data-day="${drag.dayKey}"]`);
      if (!col) return;
      onResize(drag.entry, drag.edge, drag.dayKey, minutesAt(col, e.clientY));
    }
  }

  return {
    ghost,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => {
        dragRef.current = null;
        setGhost(null);
      },
    },
  };
}
