"use client";

import { formatDuration } from "@timekeep/core";
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
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { ListChecksIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { TaskDTO } from "@/lib/catalog-types";
import { deleteTaskAction, updateTaskAction } from "@/server/actions/tasks";

import { TaskDialog } from "./task-dialog";

export function TasksTab({
  slug,
  projectId,
  tasks,
}: {
  slug: string;
  projectId: string;
  tasks: TaskDTO[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<TaskDTO | null>(null);
  const [deleting, setDeleting] = useState<TaskDTO | null>(null);

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

  const renderTable = (rows: TaskDTO[]) => (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead className="text-right">Tracked</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
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

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Tasks</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> Add task
        </Button>
      </div>
      {active.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
          <ListChecksIcon className="text-muted-foreground mb-3 size-8" />
          <p className="font-medium">No tasks yet</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Tasks split a project into pieces people pick in the timer bar.
          </p>
        </div>
      ) : (
        renderTable(active)
      )}
      {done.length > 0 ? (
        <section aria-label="Done tasks" className="mt-8">
          <h2 className="text-muted-foreground mb-3 text-base font-semibold">Done</h2>
          {renderTable(done)}
        </section>
      ) : null}

      {creating ? (
        <TaskDialog
          slug={slug}
          projectId={projectId}
          open
          onOpenChange={(open) => !open && setCreating(false)}
        />
      ) : null}
      {renaming ? (
        <TaskDialog
          key={renaming.id}
          slug={slug}
          projectId={projectId}
          task={renaming}
          open
          onOpenChange={(open) => !open && setRenaming(null)}
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
