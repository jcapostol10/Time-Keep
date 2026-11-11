"use client";

import { addDaysToKey } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import type { AssignmentDTO } from "@/lib/schedule-types";

import { AssignmentDialog, type AssignmentDialogMode } from "./assignment-dialog";
import { PublishBar } from "./publish-bar";
import { RangeNav } from "./range-nav";
import { type GridHandlers, ScheduleGrid } from "./schedule-grid";
import { ZOOMS, type Zoom } from "./schedule-model";
import { useScheduleRange } from "./use-range";
import { useScheduleWrites, useTeamSchedule } from "./use-schedule";

/**
 * The Team tab (decision 14): the grid over a week, two weeks or a month,
 * the publish bar while drafts exist, and the assignment dialog for the
 * gestures that need details (a drag across empty days, a click on a bar).
 */
export function TeamSchedule({
  slug,
  viewerId,
  from,
  zoom,
  today,
  weekStart,
}: {
  slug: string;
  viewerId: string;
  from: string;
  zoom: Zoom;
  today: string;
  weekStart: number;
}) {
  const nav = useScheduleRange({ from, zoom, today, weekStart });
  const { data } = useTeamSchedule(slug, nav.range);
  const writes = useScheduleWrites(slug);
  const [dialog, setDialog] = useState<AssignmentDialogMode | null>(null);
  const people = data?.people ?? [];
  const assignments = data?.assignments ?? [];

  const handlers: GridHandlers = {
    onCreate: (userId, startDate, endDate) =>
      setDialog({ kind: "new", userId, startDate, endDate }),
    onEdit: (a: AssignmentDTO) =>
      a.editable ? setDialog({ kind: "edit", assignment: a }) : undefined,
    onChange: (a, change, copy) => {
      if (copy) void writes.copy(a.id, { userId: change.userId, startDate: change.startDate });
      else void writes.update(a.id, change, "Assignment moved");
    },
    onCopy: (a) => void writes.copy(a.id, { startDate: addDaysToKey(a.endDate, 1) }),
    onSplit: (a, day) => void writes.split(a.id, day),
    onDelete: (a) => void writes.remove(a.id),
  };

  function add() {
    const own = people.find((p) => p.userId === viewerId) ?? people[0];
    const day = today >= nav.range.from && today <= nav.range.to ? today : nav.range.from;
    setDialog({ kind: "new", userId: own?.userId ?? "", startDate: day, endDate: day });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PublishBar
          slug={slug}
          draftCount={data?.draftCount ?? 0}
          lastPublishedAt={data?.lastPublishedAt ?? null}
        />
        <Button onClick={add}>
          <PlusIcon className="size-4" /> Add assignment
        </Button>
      </div>
      <RangeNav
        range={nav.range}
        zoom={nav.zoom}
        zooms={ZOOMS}
        onShift={nav.shift}
        onToday={nav.today}
        onZoom={nav.setZoom}
      />
      {data && people.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody here to schedule.</p>
      ) : (
        <ScheduleGrid
          label="Team schedule"
          days={nav.days}
          people={people}
          assignments={assignments}
          handlers={handlers}
        />
      )}
      {dialog ? (
        <AssignmentDialog
          slug={slug}
          mode={dialog}
          people={people}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
