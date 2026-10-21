"use client";

import { type TaskInput, taskInputSchema } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@timekeep/ui/components/form";
import { Input } from "@timekeep/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import type { TaskDTO } from "@/lib/catalog-types";
import { createTaskAction, updateTaskAction } from "@/server/actions/tasks";

import type { MemberOption } from "./tasks-tab";

type FormValues = z.input<typeof taskInputSchema>;

/** Add a task (no `task`) or rename it and change its assignees. */
export function TaskDialog({
  slug,
  projectId,
  members,
  task,
  open,
  onOpenChange,
}: {
  slug: string;
  projectId: string;
  members: MemberOption[];
  task?: TaskDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useForm<FormValues, unknown, TaskInput>({
    resolver: zodResolver(taskInputSchema),
    defaultValues: { name: task?.name ?? "", assigneeIds: task?.assigneeIds ?? [] },
  });

  async function onSubmit(values: TaskInput) {
    const result = task
      ? await updateTaskAction(slug, task.id, values)
      : await createTaskAction(slug, projectId, values);
    if (!result.ok) {
      if (/already exists/.test(result.error)) form.setError("name", { message: result.error });
      else toast.error(result.error);
      return;
    }
    toast.success(task ? "Task updated" : `Task "${values.name}" added`);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Rename task" : "New task"}</DialogTitle>
          <DialogDescription>
            {task
              ? "Change the name or who is on it."
              : "Anyone on the project can track time on it."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="assigneeIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assignees</FormLabel>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                    {members.map((m) => {
                      const selected = (field.value ?? []).includes(m.id);
                      return (
                        <label key={m.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            aria-label={m.name}
                            checked={selected}
                            onCheckedChange={(checked) => {
                              const current = field.value ?? [];
                              field.onChange(
                                checked ? [...current, m.id] : current.filter((id) => id !== m.id),
                              );
                            }}
                          />
                          {m.name}
                        </label>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {task ? "Save changes" : "Add task"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
