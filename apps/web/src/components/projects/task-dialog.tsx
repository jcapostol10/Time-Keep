"use client";

import { type TaskInput, taskInputSchema } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
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

type FormValues = z.input<typeof taskInputSchema>;

/**
 * Add a task (no `task`) or rename it. Per-person assignees are no longer
 * edited here (decision 11: tasks belong to groups).
 */
export function TaskDialog({
  slug,
  projectId,
  task,
  open,
  onOpenChange,
}: {
  slug: string;
  projectId: string;
  task?: TaskDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useForm<FormValues, unknown, TaskInput>({
    resolver: zodResolver(taskInputSchema),
    defaultValues: { name: task?.name ?? "" },
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
            {task ? "Change the name." : "Anyone on the project can track time on it."}
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
