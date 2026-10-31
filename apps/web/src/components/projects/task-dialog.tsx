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

import type { GroupOption } from "./tasks-tab";

type FormValues = z.input<typeof taskInputSchema>;

const PICK_A_GROUP = "Pick at least one group.";

/**
 * Add a task (no `task`) or rename it and change its groups (decision 11).
 * With tasks by group a task needs at least one group; on a private project
 * the groups also get the project's access (rule 9).
 */
export function TaskDialog({
  slug,
  projectId,
  groups,
  byGroup,
  isPrivate,
  task,
  open,
  onOpenChange,
}: {
  slug: string;
  projectId: string;
  groups: GroupOption[];
  byGroup: boolean;
  isPrivate: boolean;
  task?: TaskDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useForm<FormValues, unknown, TaskInput>({
    resolver: zodResolver(taskInputSchema),
    defaultValues: { name: task?.name ?? "", groupIds: task?.groupIds ?? [] },
  });

  async function onSubmit(values: TaskInput) {
    // A new task needs a group; renaming one that has none does not force a choice.
    if (byGroup && !task && values.groupIds.length === 0) {
      form.setError("groupIds", { message: PICK_A_GROUP });
      return;
    }
    const result = task
      ? await updateTaskAction(slug, task.id, { name: values.name, groupIds: values.groupIds })
      : await createTaskAction(slug, projectId, values);
    if (!result.ok) {
      if (/already exists/.test(result.error)) form.setError("name", { message: result.error });
      else if (result.error === PICK_A_GROUP) form.setError("groupIds", { message: result.error });
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
              ? "Change the name or the groups."
              : byGroup
                ? "Only the members of its groups can track time on it."
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
              name="groupIds"
              render={({ field }) => (
                <FormItem>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">
                      Groups{byGroup ? "" : " (optional)"}
                    </legend>
                    {groups.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No groups yet: create one on the Team page.
                      </p>
                    ) : (
                      <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                        {groups.map((g) => {
                          const current = field.value ?? [];
                          return (
                            <label key={g.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                aria-label={g.name}
                                checked={current.includes(g.id)}
                                onCheckedChange={(checked) => {
                                  form.clearErrors("groupIds");
                                  field.onChange(
                                    checked
                                      ? [...current, g.id]
                                      : current.filter((id) => id !== g.id),
                                  );
                                }}
                              />
                              {g.name}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </fieldset>
                  {isPrivate ? (
                    <p className="text-muted-foreground text-sm">
                      Groups you pick here will also get access to this private project.
                    </p>
                  ) : null}
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
