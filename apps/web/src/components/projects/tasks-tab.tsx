"use client";

import { formatDuration, type TaskVisibility } from "@timekeep/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@timekeep/ui/components/alert-dialog";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Label } from "@timekeep/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { ListChecksIcon, MoreHorizontalIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import type { TaskDTO } from "@/lib/catalog-types";
import { deleteTaskAction, setTaskGroupsAction, updateTaskAction } from "@/server/actions/tasks";

import { ChecklistDialog } from "../shared/checklist-dialog";
import { TaskDialog } from "./task-dialog";

export interface GroupOption {
  id: string;
  name: string;
}

/** The project's tasks with their groups (decision 11): chips, a multi-select, and the "No group" cases. */
export function TasksTab({
  slug,
  projectId,
  tasks,
  groups,
  taskVisibility,
  projectVisibility,
}: {
  slug: string;
  projectId: string;
  tasks: TaskDTO[];
  groups: GroupOption[];
  taskVisibility: TaskVisibility;
  projectVisibility: "PUBLIC" | "PRIVATE";
}) {
  const router = useRouter();
  const filterId = useId();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<TaskDTO | null>(null);
  const [deleting, setDeleting] = useState<TaskDTO | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [noGroupOnly, setNoGroupOnly] = useState(false);
  const [groupsDialog, setGroupsDialog] = useState<"add" | "remove" | null>(null);

  const byGroup = taskVisibility === "BY_GROUP";
  const isPrivate = projectVisibility === "PRIVATE";
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? "Something went wrong.");
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  const active = tasks.filter((t) => t.status === "ACTIVE");
  const done = tasks.filter((t) => t.status === "DONE");
  const ungrouped = active.filter((t) => t.groupIds.length === 0).length;
  const shown = noGroupOnly ? active.filter((t) => t.groupIds.length === 0) : active;
  const selectedIds = [...selected].filter((id) => tasks.some((t) => t.id === id));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const renderTable = (rows: TaskDTO[]) => {
    const allPicked = rows.length > 0 && rows.every((t) => selected.has(t.id));
    return (
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-0">
                <Checkbox
                  aria-label="Select all tasks"
                  checked={allPicked}
                  onCheckedChange={(on) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const t of rows) {
                        if (on === true) next.add(t.id);
                        else next.delete(t.id);
                      }
                      return next;
                    })
                  }
                />
              </TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead className="text-right">Tracked</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id} data-state={selected.has(t.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${t.name}`}
                    checked={selected.has(t.id)}
                    onCheckedChange={(on) => toggle(t.id, on === true)}
                  />
                </TableCell>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {t.groupIds.map((id) => (
                      <Badge key={id} variant="secondary">
                        {groupName.get(id) ?? "Group"}
                      </Badge>
                    ))}
                    {t.groupIds.length === 0 ? (
                      byGroup ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          No group
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(t.trackedSeconds, "hh:mm:ss")}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="More actions">
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(t)}>Rename</DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          run(
                            () =>
                              updateTaskAction(slug, t.id, {
                                status: t.status === "DONE" ? "ACTIVE" : "DONE",
                              }),
                            t.status === "DONE" ? `${t.name} reopened` : `${t.name} marked done`,
                          )
                        }
                      >
                        {t.status === "DONE" ? "Reopen" : "Mark done"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(t)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Tasks</h2>
        <div className="flex flex-wrap items-center gap-4">
          {byGroup ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${filterId}-no-group`}
                checked={noGroupOnly}
                onCheckedChange={(on) => setNoGroupOnly(on === true)}
              />
              <Label htmlFor={`${filterId}-no-group`} className="font-normal">
                No group only
              </Label>
            </div>
          ) : null}
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon /> Add task
          </Button>
        </div>
      </div>

      {byGroup && ungrouped > 0 ? (
        <div
          role="status"
          className="bg-muted text-muted-foreground mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <UsersIcon className="size-4 shrink-0" aria-hidden />
          <span>
            {ungrouped} active {ungrouped === 1 ? "task has" : "tasks have"} no group. Members
            cannot see {ungrouped === 1 ? "it" : "them"}.
          </span>
        </div>
      ) : null}

      {selectedIds.length > 0 ? (
        <div
          role="toolbar"
          aria-label="Task actions"
          className="bg-background mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
        >
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => setGroupsDialog("add")}>
            Add to groups…
          </Button>
          <Button size="sm" variant="outline" onClick={() => setGroupsDialog("remove")}>
            Remove from groups…
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      {active.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
          <ListChecksIcon className="text-muted-foreground mb-3 size-8" />
          <p className="font-medium">No tasks yet</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Tasks split a project into pieces people pick in the timer bar.
          </p>
        </div>
      ) : (
        renderTable(shown)
      )}
      {done.length > 0 && !noGroupOnly ? (
        <section aria-label="Done tasks" className="mt-8">
          <h2 className="text-muted-foreground mb-3 text-base font-semibold">Done</h2>
          {renderTable(done)}
        </section>
      ) : null}

      {creating ? (
        <TaskDialog
          slug={slug}
          projectId={projectId}
          groups={groups}
          byGroup={byGroup}
          isPrivate={isPrivate}
          open
          onOpenChange={(open) => !open && setCreating(false)}
        />
      ) : null}
      {renaming ? (
        <TaskDialog
          key={renaming.id}
          slug={slug}
          projectId={projectId}
          groups={groups}
          byGroup={byGroup}
          isPrivate={isPrivate}
          task={renaming}
          open
          onOpenChange={(open) => !open && setRenaming(null)}
        />
      ) : null}
      {groupsDialog ? (
        <ChecklistDialog
          title={`${groupsDialog === "add" ? "Add" : "Remove"} ${selectedIds.length} ${selectedIds.length === 1 ? "task" : "tasks"} ${groupsDialog === "add" ? "to" : "from"} groups`}
          options={groups}
          initial={[]}
          empty="No groups yet: create one on the Team page."
          submit="Apply"
          note={
            groupsDialog === "add" && isPrivate
              ? "These groups will also get access to this private project."
              : undefined
          }
          onClose={() => setGroupsDialog(null)}
          onSave={async (groupIds) => {
            const mode = groupsDialog;
            const result = await setTaskGroupsAction(slug, {
              taskIds: selectedIds,
              groupIds,
              mode,
            });
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            toast.success(mode === "add" ? "Groups added" : "Groups removed");
            setGroupsDialog(null);
            setSelected(new Set());
            router.refresh();
            return true;
          }}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.entryCount
                ? `${deleting.entryCount} ${deleting.entryCount === 1 ? "entry keeps" : "entries keep"} the project but ${deleting.entryCount === 1 ? "loses" : "lose"} the task.`
                : "No entries are affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleting) return;
                const target = deleting;
                setDeleting(null);
                run(() => deleteTaskAction(slug, target.id), `${target.name} deleted`);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
