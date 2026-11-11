"use client";

import { daysBetweenKeys, formatDateKey } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import type { AssignmentDTO, MilestoneDTO } from "@/lib/schedule-types";

import { AssignmentBar, LANE_PX } from "./assignment-bar";
import { AssignmentDialog } from "./assignment-dialog";
import { MilestoneDialog } from "./milestone-dialog";
import { RangeNav } from "./range-nav";
import { rowSegments } from "./schedule-grid";
import { ZOOMS, type Zoom } from "./schedule-model";
import { useScheduleRange } from "./use-range";
import { hm, useTeamSchedule } from "./use-schedule";

/**
 * The Projects tab (decision 16): a row per project with assignments or
 * milestones in the range, its assigned hours, milestones as diamonds, and
 * its people's bars when expanded (a click opens the assignment).
 */
export function ProjectSchedule({
  slug,
  from,
  zoom,
  today,
  weekStart,
  manageable,
}: {
  slug: string;
  from: string;
  zoom: Zoom;
  today: string;
  weekStart: number;
  /** Projects the viewer may add milestones to. */
  manageable: { id: string; name: string }[];
}) {
  const nav = useScheduleRange({ from, zoom, today, weekStart });
  const { data } = useTeamSchedule(slug, nav.range);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [milestone, setMilestone] = useState<MilestoneDTO | "new" | null>(null);
  const [editing, setEditing] = useState<AssignmentDTO | null>(null);
  const days = nav.days;
  const people = data?.people ?? [];
  const nameOf = new Map(people.map((p) => [p.userId, p.name]));

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {manageable.length > 0 ? (
          <Button onClick={() => setMilestone("new")}>
            <PlusIcon className="size-4" /> Add milestone
          </Button>
        ) : null}
      </div>
      <RangeNav
        range={nav.range}
        zoom={nav.zoom}
        zooms={ZOOMS}
        onShift={nav.shift}
        onToday={nav.today}
        onZoom={nav.setZoom}
      />
      {data && data.projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing planned in this range.</p>
      ) : null}
      <ul aria-label="Project schedule" className="divide-y overflow-x-auto rounded-lg border">
        {(data?.projects ?? []).map((p) => {
          const mine = (data?.assignments ?? []).filter((a) => a.project?.id === p.id);
          const total = mine.reduce(
            (n, a) => n + Object.values(a.days).reduce((x, y) => x + y, 0),
            0,
          );
          const diamonds = (data?.milestones ?? []).filter((m) => m.projectId === p.id);
          const expanded = open.has(p.id);
          const byPerson = [...new Set(mine.map((a) => a.userId))];
          return (
            <li key={p.id} className="min-w-[640px]">
              <div className="flex items-center">
                <div className="flex w-56 shrink-0 items-center gap-2 px-3 py-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Expand"
                    aria-expanded={expanded}
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                  >
                    {expanded ? (
                      <ChevronDownIcon className="size-4" />
                    ) : (
                      <ChevronRightIcon className="size-4" />
                    )}
                  </Button>
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      {hm(total)} assigned
                    </div>
                  </div>
                </div>
                <div className="relative h-10 flex-1">
                  {diamonds.map((m) => {
                    const i = daysBetweenKeys(days[0]!, m.date);
                    const label = `Milestone: ${m.name}, ${formatDateKey(m.date)}`;
                    return (
                      <span
                        key={m.id}
                        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${((i + 0.5) / days.length) * 100}%` }}
                      >
                        <span
                          role="img"
                          aria-label={label}
                          title={label}
                          className={
                            m.editable
                              ? "block size-3 rotate-45 cursor-pointer border border-amber-700 bg-amber-400"
                              : "block size-3 rotate-45 border border-amber-700 bg-amber-400"
                          }
                          onClick={() => (m.editable ? setMilestone(m) : undefined)}
                        />
                        {m.editable ? (
                          <button
                            type="button"
                            className="sr-only focus:not-sr-only"
                            onClick={() => setMilestone(m)}
                          >
                            Edit milestone {m.name}
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </div>
              {expanded ? (
                <div className="border-t">
                  {byPerson.map((userId) => {
                    const { segments, laneCount } = rowSegments(
                      mine.filter((a) => a.userId === userId),
                      days,
                    );
                    return (
                      <div key={userId} className="flex">
                        <div className="text-muted-foreground w-56 shrink-0 truncate px-3 py-1.5 pl-14 text-sm">
                          {nameOf.get(userId) ?? "(former member)"}
                        </div>
                        <div
                          className="relative flex-1"
                          style={{ height: laneCount * LANE_PX + 8 }}
                        >
                          {segments.map((s) => (
                            <AssignmentBar
                              key={s.key}
                              a={s.a}
                              segment={s.segment}
                              first={s.first}
                              last={s.last}
                              count={days.length}
                              lane={s.lane}
                              onEdit={() => (s.a.editable ? setEditing(s.a) : undefined)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {milestone ? (
        <MilestoneDialog
          slug={slug}
          milestone={milestone === "new" ? null : milestone}
          projects={manageable}
          defaultDate={nav.range.from}
          onClose={() => setMilestone(null)}
        />
      ) : null}
      {editing ? (
        <AssignmentDialog
          slug={slug}
          mode={{ kind: "edit", assignment: editing }}
          people={people}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
