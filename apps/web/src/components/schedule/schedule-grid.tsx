"use client";

import {
  addDaysToKey,
  type AssignmentShape,
  daysBetweenKeys,
  heatOf,
  occurrences,
  stackLanes,
} from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AssignmentDTO, SchedulePerson } from "@/lib/schedule-types";

import { AssignmentBar, LANE_PX } from "./assignment-bar";
import { dayIndexAt, type DragKind, dragMoved, dragResult, rowWindow } from "./schedule-model";
import { hm } from "./use-schedule";

const HEADER_PX = 176;
const COLUMN_MIN_PX = 44;
const ROW_PAD_PX = 14;

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DAY_LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayDate = (key: string) => new Date(`${key}T00:00:00Z`);

export function shapeOf(a: AssignmentDTO): AssignmentShape {
  return {
    startDate: a.startDate,
    endDate: a.endDate,
    mode: a.mode,
    minutesPerDay: a.minutesPerDay,
    totalMinutes: a.totalMinutes,
    includeNonWorking: a.includeNonWorking,
    repeatWeeks: a.repeatWeeks,
    repeatUntil: a.repeatUntil,
  };
}

/** Each occurrence of the row's assignments in view, with its columns and lane. */
export function rowSegments(assignments: readonly AssignmentDTO[], days: readonly string[]) {
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const segments = assignments.flatMap((a) =>
    occurrences(shapeOf(a))
      .filter((o) => o.endDate >= from && o.startDate <= to)
      .map((o) => ({
        key: `${a.id}:${o.startDate}`,
        a,
        segment: o,
        first: Math.max(0, daysBetweenKeys(from, o.startDate)),
        last: Math.min(days.length - 1, daysBetweenKeys(from, o.endDate)),
      })),
  );
  const lanes = stackLanes(
    segments.map((s) => ({
      id: s.key,
      startDate: s.segment.startDate,
      endDate: s.segment.endDate,
    })),
  );
  const laneCount = Math.max(1, ...segments.map((s) => (lanes.get(s.key) ?? 0) + 1));
  return { segments: segments.map((s) => ({ ...s, lane: lanes.get(s.key) ?? 0 })), laneCount };
}

interface Drag {
  kind: DragKind;
  userId: string;
  assignment: AssignmentDTO | null;
  origin: number;
  current: number;
  targetUserId: string;
}

export interface GridHandlers {
  onCreate: (userId: string, startDate: string, endDate: string) => void;
  onEdit: (a: AssignmentDTO) => void;
  onChange: (
    a: AssignmentDTO,
    change: { startDate: string; endDate: string; repeatUntil?: string | null; userId?: string },
    copy: boolean,
  ) => void;
  onCopy: (a: AssignmentDTO) => void;
  onSplit: (a: AssignmentDTO, day: string) => void;
  onDelete: (a: AssignmentDTO) => void;
}

/**
 * The team grid (decisions 12, 14, 15): a row per person, a column per day,
 * the heat of each day under its bars. Rows are windowed: only those in view
 * (and a margin) are rendered, spacers stand in for the rest.
 */
export function ScheduleGrid({
  label,
  days,
  people,
  assignments,
  handlers,
}: {
  label: string;
  days: string[];
  people: SchedulePerson[];
  assignments: AssignmentDTO[];
  handlers: GridHandlers;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ key: string; day: string | null } | null>(null);

  const rows = useMemo(
    () =>
      people.map((p) => {
        const mine = assignments.filter((a) => a.userId === p.userId);
        const { segments, laneCount } = rowSegments(mine, days);
        const scheduled = new Map<string, number>();
        for (const a of mine) {
          for (const [k, m] of Object.entries(a.days))
            scheduled.set(k, (scheduled.get(k) ?? 0) + m);
        }
        return { person: p, segments, height: laneCount * LANE_PX + ROW_PAD_PX, scheduled };
      }),
    [people, assignments, days],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setScroll((s) => ({ ...s, height: el.clientHeight })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const win = rowWindow(
    rows.map((r) => r.height),
    scroll.top,
    scroll.height,
  );

  // The drag follows the pointer anywhere on the page; the row under it decides a move's person.
  useEffect(() => {
    if (!drag) return;
    function at(e: PointerEvent): { index: number; userId: string } | null {
      const track = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-track]");
      if (!track) return null;
      const rect = track.getBoundingClientRect();
      return {
        index: dayIndexAt(e.clientX, rect.left, rect.width, days.length),
        userId: track.dataset.userId ?? "",
      };
    }
    function move(e: PointerEvent) {
      const hit = at(e);
      if (!hit) return;
      setDrag((d) =>
        d
          ? {
              ...d,
              current: hit.index,
              targetUserId: d.kind === "move" ? hit.userId : d.targetUserId,
            }
          : d,
      );
    }
    function up(e: PointerEvent) {
      const hit = at(e);
      const d = drag!;
      const current = hit?.index ?? d.current;
      const target = d.kind === "move" && hit ? hit.userId : d.targetUserId;
      setDrag(null);
      if (d.kind === "create") {
        const r = dragResult("create", d.origin, current, null, days);
        handlers.onCreate(d.userId, r.startDate, r.endDate);
        return;
      }
      const a = d.assignment!;
      const result = dragResult(d.kind, d.origin, current, shapeOf(a), days);
      const moved = dragMoved(a, result) || target !== a.userId;
      if (!moved) {
        if (d.kind === "move") handlers.onEdit(a);
        return;
      }
      handlers.onChange(
        a,
        {
          startDate: result.startDate,
          endDate: result.endDate,
          ...(a.repeatUntil && "repeatUntil" in result
            ? { repeatUntil: (result as AssignmentShape).repeatUntil }
            : {}),
          ...(target !== a.userId ? { userId: target } : {}),
        },
        d.kind === "move" && e.altKey,
      );
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, days, handlers]);

  function begin(
    e: React.PointerEvent,
    kind: DragKind,
    userId: string,
    assignment: AssignmentDTO | null,
  ) {
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    // React bubbles events from portals (a bar's menu) through its tree: only the grid's own DOM drags.
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-track]");
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const index = dayIndexAt(e.clientX, rect.left, rect.width, days.length);
    setDrag({ kind, userId, assignment, origin: index, current: index, targetUserId: userId });
  }

  function dayAt(e: React.MouseEvent): string | null {
    const track = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-track]");
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    return days[dayIndexAt(e.clientX, rect.left, rect.width, days.length)] ?? null;
  }

  const ghost = (() => {
    if (!drag) return null;
    const r =
      drag.kind === "create" || !drag.assignment
        ? dragResult("create", drag.origin, drag.current, null, days)
        : dragResult(drag.kind, drag.origin, drag.current, shapeOf(drag.assignment), days);
    const first = Math.max(0, daysBetweenKeys(days[0]!, r.startDate));
    const last = Math.min(days.length - 1, daysBetweenKeys(days[0]!, r.endDate));
    if (last < 0 || first > days.length - 1) return null;
    return { userId: drag.targetUserId, first, last };
  })();

  const minWidth = HEADER_PX + days.length * COLUMN_MIN_PX;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        ref={scrollRef}
        className="max-h-[70vh] overflow-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setScroll({ top: el.scrollTop, height: el.clientHeight });
        }}
      >
        <div role="grid" aria-label={label} style={{ minWidth }} className="select-none">
          <div role="row" className="bg-muted sticky top-0 z-20 flex border-b">
            <div
              role="columnheader"
              className="bg-muted sticky left-0 z-10 shrink-0 px-3 py-2 text-xs font-medium"
              style={{ width: HEADER_PX }}
            >
              Person
            </div>
            {days.map((d) => (
              <div
                key={d}
                role="columnheader"
                className="min-w-0 flex-1 border-l px-1 py-2 text-center text-xs font-medium"
              >
                {DAY_LABEL.format(dayDate(d))}
              </div>
            ))}
          </div>
          <div style={{ height: win.before }} role="presentation" />
          {rows.slice(win.start, win.end).map(({ person, segments, height, scheduled }) => (
            <div
              key={person.userId}
              role="row"
              data-user-id={person.userId}
              className="flex border-b last:border-b-0"
              style={{ height }}
            >
              <div
                role="rowheader"
                className="bg-background sticky left-0 z-10 shrink-0 px-3 py-1.5"
                style={{ width: HEADER_PX }}
              >
                <div className="truncate text-sm font-medium">{person.name}</div>
                <div className="text-muted-foreground text-xs tabular-nums">
                  {hm(person.scheduledMinutes)} of {hm(person.capacityMinutes)}
                </div>
              </div>
              <div
                data-track
                data-user-id={person.userId}
                className="relative flex-1"
                onPointerDown={(e) => begin(e, "create", person.userId, null)}
              >
                <div className="absolute inset-0 flex">
                  {days.map((d) => {
                    const cap = person.capacity[d] ?? 0;
                    const sched = scheduled.get(d) ?? 0;
                    const heat = heatOf(sched, cap);
                    const holiday = person.holidays[d];
                    return (
                      <div
                        key={d}
                        role="gridcell"
                        data-day={d}
                        data-heat={heat ?? undefined}
                        aria-label={`${DAY_LONG.format(dayDate(d))}: ${hm(sched)} of ${hm(cap)} scheduled${holiday ? ` (${holiday})` : ""}`}
                        title={holiday ? `Holiday: ${holiday}` : undefined}
                        className={cn(
                          "relative min-w-0 flex-1 border-l",
                          cap === 0 && "bg-muted/50",
                        )}
                      >
                        {heat ? (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute inset-x-0 bottom-0 h-1",
                              heat === "over" && "bg-red-500",
                              heat === "at" && "bg-emerald-500",
                              heat === "under" && "bg-amber-400",
                            )}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {ghost && ghost.userId === person.userId ? (
                  <div
                    aria-hidden
                    className="bg-primary/20 border-primary pointer-events-none absolute inset-y-1 rounded border-2 border-dashed"
                    style={{
                      left: `${(ghost.first / days.length) * 100}%`,
                      width: `${((ghost.last - ghost.first + 1) / days.length) * 100}%`,
                    }}
                  />
                ) : null}
                {segments.map((s) => (
                  <AssignmentBar
                    key={s.key}
                    a={s.a}
                    segment={s.segment}
                    first={s.first}
                    last={s.last}
                    count={days.length}
                    lane={s.lane}
                    onPointerStart={(e, kind) => begin(e, kind, person.userId, s.a)}
                    onEdit={() => handlers.onEdit(s.a)}
                    menu={{
                      open: menu?.key === s.key,
                      splitDay: menu?.key === s.key ? menu.day : null,
                      onOpenChange: (open) => setMenu(open ? { key: s.key, day: null } : null),
                      onContextMenu: (e) => {
                        e.preventDefault();
                        setMenu({ key: s.key, day: dayAt(e) });
                      },
                      onCopy: () => handlers.onCopy(s.a),
                      onSplit: (day) => handlers.onSplit(s.a, day),
                      onDelete: () => handlers.onDelete(s.a),
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div style={{ height: win.after }} role="presentation" />
        </div>
      </div>
    </div>
  );
}

export const nextDay = (key: string) => addDaysToKey(key, 1);
