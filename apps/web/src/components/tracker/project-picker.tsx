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
import { CheckIcon, CornerDownRightIcon, FolderIcon, PlusIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import type { PickerProject } from "@/lib/tracker-types";
import { createProjectAction } from "@/server/actions/projects";
import { createTaskAction } from "@/server/actions/tasks";

import { trackDraftWrite } from "./draft-writes";
import { useTargetKey } from "./target-context";
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

export interface ProjectSelection {
  projectId: string | null;
  taskId: string | null;
}

/** What an entry already carries, shown when the picker no longer lists it (archived, done). */
export interface CurrentSelection {
  project: { name: string; color: string } | null;
  task: { name: string } | null;
}

interface Group {
  key: string;
  label: string;
  projects: PickerProject[];
}

/**
 * Favourites first (listed there only, so every option stays unique), then
 * one group per client in name order, then projects without a client.
 */
export function groupProjects(projects: PickerProject[]): Group[] {
  const favourites = projects.filter((p) => p.favorite);
  const byClient = new Map<string, Group>();
  for (const p of projects) {
    if (p.favorite) continue;
    const key = p.clientId ?? "__none__";
    const group = byClient.get(key) ?? {
      key,
      label: p.clientName ?? "No client",
      projects: [],
    };
    group.projects.push(p);
    byClient.set(key, group);
  }
  const clients = [...byClient.values()].sort((a, b) => {
    if (a.key === "__none__") return 1;
    if (b.key === "__none__") return -1;
    return a.label.localeCompare(b.label);
  });
  return favourites.length > 0
    ? [{ key: "__favourites__", label: "Favourites", projects: favourites }, ...clients]
    : clients;
}

/**
 * Picks a project, or a task and with it its project. Projects are grouped
 * by client with favourites first; typing searches project and task names.
 * Admins can create a project from here.
 */
export function ProjectPicker({
  slug,
  value,
  onChange,
  compact = false,
  disabled = false,
  canCreate = false,
  invalid = false,
  current = null,
}: {
  slug: string;
  value: ProjectSelection;
  onChange: (selection: ProjectSelection) => void;
  /** Icon-only trigger when nothing is selected (entry rows). */
  compact?: boolean;
  disabled?: boolean;
  canCreate?: boolean;
  /** The server refused a save for the project or task (required fields). */
  invalid?: boolean;
  current?: CurrentSelection | null;
}) {
  const { data } = useTrackerOptions(slug, useTargetKey());
  const cache = useTrackerCache(slug, useTargetKey());
  const projects = useMemo(() => data?.projects ?? [], [data]);
  const groups = useMemo(() => groupProjects(projects), [projects]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const listed = projects.find((p) => p.id === value.projectId);
  const project =
    listed ??
    (value.projectId && current?.project
      ? { id: value.projectId, name: current.project.name, color: current.project.color, tasks: [] }
      : null);
  const task = value.taskId
    ? (listed?.tasks.find((t) => t.id === value.taskId) ??
      (current?.task ? { id: value.taskId, name: current.task.name } : null))
    : null;
  const label = project ? `${project.name}${task ? ` › ${task.name}` : ""}` : "none";

  const trimmed = query.trim();
  const showCreate =
    canCreate &&
    trimmed.length > 0 &&
    !projects.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());

  // A task is created in the chosen project (by its managers and admins: the
  // project says), once the typed name matches none of its tasks.
  const showCreateTask =
    listed !== undefined &&
    listed.canCreateTask &&
    trimmed.length > 0 &&
    !listed.tasks.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  function choose(selection: ProjectSelection) {
    onChange(selection);
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
    choose({ projectId: result.data.id, taskId: null });
  }

  async function createTask() {
    if (!listed) return;
    setCreating(true);
    const result = await createTaskAction(slug, listed.id, { name: trimmed });
    setCreating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    cache.addTask(listed.id, { id: result.data.id, name: result.data.name });
    choose({ projectId: listed.id, taskId: result.data.id });
  }

  // cmdk needs a unique value per item; names are unique within a client.
  const projectValue = (p: PickerProject) => `${p.name} · ${p.clientName ?? "no client"}`;

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
          aria-label={`Project: ${label}`}
          aria-invalid={invalid || undefined}
          className={cn(
            "max-w-56 justify-start",
            !project && "text-muted-foreground",
            invalid && "ring-destructive ring-2",
          )}
        >
          {project ? (
            <>
              <ColorDot color={project.color} />
              <span className="truncate" style={{ color: project.color }}>
                {project.name}
                {task ? <span className="text-foreground"> › {task.name}</span> : null}
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
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput
            aria-label="Search projects"
            placeholder={canCreate ? "Search or create project" : "Search projects and tasks"}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__no_project__"
                onSelect={() => choose({ projectId: null, taskId: null })}
              >
                <span className="text-muted-foreground">No project</span>
                {value.projectId === null ? <CheckIcon className="ml-auto" /> : null}
              </CommandItem>
            </CommandGroup>
            {groups.map((group) => (
              <CommandGroup key={group.key} heading={group.label}>
                {group.projects.map((p) => (
                  <Fragment key={p.id}>
                    <CommandItem
                      value={projectValue(p)}
                      keywords={[p.name]}
                      onSelect={() => choose({ projectId: p.id, taskId: null })}
                    >
                      <ColorDot color={p.color} />
                      <span className="truncate">{p.name}</span>
                      {p.id === value.projectId && value.taskId === null ? (
                        <CheckIcon className="ml-auto" />
                      ) : null}
                    </CommandItem>
                    {p.tasks.map((t) => (
                      <CommandItem
                        key={t.id}
                        value={`${projectValue(p)} › ${t.name}`}
                        keywords={[t.name, p.name]}
                        aria-label={`${p.name} › ${t.name}`}
                        onSelect={() => choose({ projectId: p.id, taskId: t.id })}
                        className="pl-7"
                      >
                        <CornerDownRightIcon className="text-muted-foreground" aria-hidden />
                        <span className="truncate">{t.name}</span>
                        {t.id === value.taskId ? <CheckIcon className="ml-auto" /> : null}
                      </CommandItem>
                    ))}
                  </Fragment>
                ))}
              </CommandGroup>
            ))}
            {showCreate ? (
              <CommandGroup>
                <CommandItem
                  value={`__create__ ${trimmed}`}
                  disabled={creating}
                  onSelect={() => void trackDraftWrite(create())}
                >
                  <PlusIcon />
                  <span className="truncate">Create project &ldquo;{trimmed}&rdquo;</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {showCreateTask ? (
              <CommandGroup>
                <CommandItem
                  value={`__create_task__ ${trimmed}`}
                  disabled={creating}
                  onSelect={() => void trackDraftWrite(createTask())}
                >
                  <PlusIcon />
                  <span className="truncate">
                    Create task &ldquo;{trimmed}&rdquo; in {listed?.name}
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
