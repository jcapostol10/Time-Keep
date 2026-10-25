"use client";

import { createWorkspaceSchema, type CreateWorkspaceInput } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
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

import { workspaceRoutes } from "@/lib/routes";
import { createWorkspaceAction } from "@/server/actions/workspaces";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const form = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: "" },
  });

  async function onSubmit(values: CreateWorkspaceInput) {
    const result = await createWorkspaceAction(values);
    if (!result.ok) {
      form.setError("name", { message: result.fieldErrors?.name?.[0] ?? result.error });
      return;
    }
    toast.success("Workspace created");
    router.push(workspaceRoutes.tracker(result.data.slug));
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workspace name</FormLabel>
              <FormControl>
                <Input placeholder="Acme Studio" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Create workspace
        </Button>
      </form>
    </Form>
  );
}
