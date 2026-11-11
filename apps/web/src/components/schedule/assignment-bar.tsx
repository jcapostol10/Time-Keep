"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { cn } from "@timekeep/ui/lib/utils";
import { MoreHorizontalIcon } from "lucide-react";

import type { AssignmentDTO } from "@/lib/schedule-types";

import type { DragKind } from "./schedule-model";
import { barLabel } from "./use-schedule";

export const LANE_PX = 28;
export const BAR_PX = 24;

/**
 * One occurrence of an assignment on a row: a bar in its project's colour
 * from its first to its last day in view. Mouse gestures start here (move,
 * resize from the edges); the menu (or a right-click) edits, copies, splits
 * at the day under the pointer, or deletes. "Another project" is grey and inert.
 */
export function AssignmentBar({
  a,
  segment,
  first,
  last,
  count,
  lane,
  onPointerStart,
  onEdit,
  menu,
}: {
  a: AssignmentDTO;
  segment: { startDate: string; endDate: string };
  /** The columns it covers in view. */
  first: number;
  last: number;
  count: number;
  lane: number;
  onPointerStart?: (e: React.PointerEvent, kind: DragKind) => void;
  onEdit?: () => void;
  menu?: {
    open: boolean;
    splitDay: string | null;
    onOpenChange: (open: boolean) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onCopy: () => void;
    onSplit: (day: string) => void;
    onDelete: () => void;
  };
}) {
  const label = barLabel(a);
  const editable = a.editable && onPointerStart;
  const color = a.project?.color ?? null;
  const canSplit =
    menu?.splitDay != null &&
    !a.repeatWeeks &&
    menu.splitDay > a.startDate &&
    menu.splitDay <= a.endDate;
  return (
    <div
      className="group absolute"
      style={{
        left: `${(first / count) * 100}%`,
        width: `${((last - first + 1) / count) * 100}%`,
        top: 4 + lane * LANE_PX,
        height: BAR_PX,
      }}
      onContextMenu={editable ? menu?.onContextMenu : undefined}
    >
      <button
        type="button"
        data-assignment-id={a.id}
        data-start={segment.startDate}
        data-end={segment.endDate}
        data-draft={a.draft}
        title={a.draft ? `${label} (unpublished)` : label}
        className={cn(
          "absolute inset-x-0.5 inset-y-0 truncate rounded border-l-4 px-1.5 text-left text-xs font-medium",
          color ? "text-foreground" : "bg-muted text-muted-foreground border-muted-foreground/40",
          a.draft && "border-dashed outline-dashed outline-1 outline-offset-0",
          editable ? "cursor-grab" : "cursor-default",
        )}
        style={color ? { borderLeftColor: color, backgroundColor: `${color}33` } : undefined}
        onPointerDown={editable ? (e) => onPointerStart?.(e, "move") : undefined}
        // Where it can be dragged, a pointer click is handled on release; a key press, or a
        // click where nothing drags (the project schedule), opens the dialog here.
        onClick={(e) => {
          if (e.detail === 0 || !editable) onEdit?.();
        }}
        disabled={!a.project}
      >
        {label}
      </button>
      {editable ? (
        <>
          <button
            type="button"
            aria-label="Resize start"
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
            onPointerDown={(e) => onPointerStart?.(e, "resize-start")}
          />
          <button
            type="button"
            aria-label="Resize end"
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
            onPointerDown={(e) => onPointerStart?.(e, "resize-end")}
          />
        </>
      ) : null}
      {editable && menu ? (
        <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Assignment actions"
              className="bg-background/80 absolute right-2.5 top-0.5 rounded p-0.5 opacity-0 focus:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontalIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit?.()}>Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={menu.onCopy}>Copy</DropdownMenuItem>
            {canSplit ? (
              <DropdownMenuItem onSelect={() => menu.onSplit(menu.splitDay!)}>
                Split here
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={menu.onDelete}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
