"use client";

import { Button } from "@timekeep/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@timekeep/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@timekeep/ui/components/popover";
import { cn } from "@timekeep/ui/lib/utils";
import { CheckIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { createProjectAction } from "@/server/actions/time-entries";

import { useTrackerCache, useTrackerOptions } from "./use-tracker-cache";

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function ProjectPicker({
  slug,
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  slug: string;
  value: string | null;
  onChange: (projectId: string | null) => void;
  /** Icon-only trigger when nothing is selected (entry rows). */
  compact?: boolean;
  disabled?: boolean;
}) {
  const { data } = useTrackerOptions(slug);
  const cache = useTrackerCache(slug);
  const projects = data?.projects ?? [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const selected = projects.find((p) => p.id === value) ?? null;
  const trimmed = query.trim();
  const canCreate =
    trimmed.length > 0 && !projects.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());

  function choose(id: string | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  async function create() {
    setCreating(true);
    const result = await createProjectAction(slug, { name: trimmed });
    setCreating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    cache.addProject(result.data);
    choose(result.data.id);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Project: ${selected?.name ?? "none"}`}
          className={cn("max-w-48 justify-start", !selected && "text-muted-foreground")}
        >
          {selected ? (
            <>
              <ColorDot color={selected.color} />
              <span className="truncate" style={{ color: selected.color }}>
                {selected.name}
              </span>
            </>
          ) : (
            <>
              <FolderIcon />
              {compact ? null : <span>Project</span>}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput
            aria-label="Search projects"
            placeholder="Search or create project"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__no_project__" onSelect={() => choose(null)}>
                <span className="text-muted-foreground">No project</span>
                {value === null ? <CheckIcon className="ml-auto" /> : null}
              </CommandItem>
              {projects.map((p) => (
                <CommandItem key={p.id} value={p.name} onSelect={() => choose(p.id)}>
                  <ColorDot color={p.color} />
                  <span className="truncate">{p.name}</span>
                  {p.id === value ? <CheckIcon className="ml-auto" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {canCreate ? (
              <CommandGroup>
                <CommandItem
                  value={`__create__ ${trimmed}`}
                  disabled={creating}
                  onSelect={() => void create()}
                >
                  <PlusIcon />
                  <span className="truncate">Create project &ldquo;{trimmed}&rdquo;</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
