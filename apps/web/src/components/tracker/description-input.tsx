"use client";

import { ENTRY_DESCRIPTION_MAX } from "@timekeep/core";
import { Input } from "@timekeep/ui/components/input";
import { cn } from "@timekeep/ui/lib/utils";
import { useId, useMemo, useState } from "react";

import type { RecentDescription } from "@/lib/tracker-types";

import { ColorDot } from "./project-picker";
import { useTrackerOptions } from "./use-tracker-cache";

const MAX_SUGGESTIONS = 8;

/**
 * Description field with autocomplete over the user's recent descriptions.
 * Picking a suggestion hands back its project, task, tags and billable flag.
 */
export function DescriptionInput({
  slug,
  value,
  onChange,
  onPick,
  onCommit,
  onEnter,
  inputRef,
  className,
}: {
  slug: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (suggestion: RecentDescription) => void;
  /** Called on blur with the current text (used to save a running entry). */
  onCommit?: (value: string) => void;
  /** Enter with no suggestion highlighted. */
  onEnter?: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  className?: string;
}) {
  const { data } = useTrackerOptions(slug);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const suggestions = useMemo(() => {
    const recent = data?.recent ?? [];
    const q = value.trim().toLowerCase();
    return recent
      .filter((r) =>
        q ? r.description.toLowerCase().includes(q) && r.description !== value : true,
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [data, value]);
  const projects = data?.projects ?? [];
  const showList = open && suggestions.length > 0;

  function pick(s: RecentDescription) {
    onPick(s);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      <Input
        ref={inputRef}
        value={value}
        maxLength={ENTRY_DESCRIPTION_MAX}
        placeholder="What are you working on?"
        aria-label="Description"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className="focus-visible:border-ring border-transparent shadow-none"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          setOpen(false);
          onCommit?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && suggestions.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp" && suggestions.length > 0) {
            e.preventDefault();
            setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
          } else if (e.key === "Enter") {
            if (e.repeat) {
              e.preventDefault();
              return;
            }
            const s = showList && active >= 0 ? suggestions[active] : undefined;
            e.preventDefault();
            if (s) pick(s);
            else {
              setOpen(false);
              onEnter?.();
            }
          } else if (e.key === "Escape" && showList) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Recent descriptions"
          className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {suggestions.map((s, i) => {
            const projectItem = projects.find((p) => p.id === s.projectId);
            return (
              <li
                key={s.description}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  i === active && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
              >
                <span className="truncate">{s.description}</span>
                {projectItem ? (
                  <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 text-xs">
                    <ColorDot color={projectItem.color} />
                    {projectItem.name}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
