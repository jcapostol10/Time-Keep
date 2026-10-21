"use client";

import { pickColor, type ProjectInput, projectInputSchema } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Form } from "@timekeep/ui/components/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import type { ProjectListItem } from "@/lib/catalog-types";
import { createProjectAction, updateProjectAction } from "@/server/actions/projects";

import { ProjectFormFields } from "./project-form-fields";
import type { ClientOption } from "./projects-toolbar";

type FormValues = z.input<typeof projectInputSchema>;

/** Create (no `project`) or edit a project's details. */
export function ProjectDialog({
  slug,
  clients,
  project,
  open,
  onOpenChange,
}: {
  slug: string;
  clients: ClientOption[];
  project?: ProjectListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useForm<FormValues, unknown, ProjectInput>({
    resolver: zodResolver(projectInputSchema),
    defaultValues: {
      name: project?.name ?? "",
      clientId: project?.clientId ?? null,
      color: project?.color ?? pickColor(""),
      billable: project?.billable ?? true,
      visibility: project?.visibility ?? "PUBLIC",
      note: project?.note ?? "",
    },
  });
  const name = useWatch({ control: form.control, name: "name" }) ?? "";
  const color = useWatch({ control: form.control, name: "color" });
  // A new project's colour follows its name until the user picks one.
  const [colorPicked, setColorPicked] = useState(Boolean(project));
  const effectiveColor = colorPicked ? (color ?? pickColor(name)) : pickColor(name);

  async function onSubmit(values: ProjectInput) {
    const payload = { ...values, color: effectiveColor };
    const result = project
      ? await updateProjectAction(slug, project.id, payload)
      : await createProjectAction(slug, payload);
    if (!result.ok) {
      const nameError = result.fieldErrors?.name?.[0];
      if (nameError) form.setError("name", { message: nameError });
      else if (/already exists/.test(result.error))
        form.setError("name", { message: result.error });
      else toast.error(result.error);
      return;
    }
    toast.success(project ? "Project updated" : `Project "${values.name}" created`);
    onOpenChange(false);
    router.refresh();
  }

  const selectableClients = clients.filter((c) => !c.archived || c.id === project?.clientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            {project
              ? "Change the project's details. Its entries keep their time."
              : "Projects group tracked time. Private projects are seen only by the people on them."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <ProjectFormFields
              form={form}
              clients={selectableClients}
              color={effectiveColor}
              onColorChange={(c) => {
                setColorPicked(true);
                form.setValue("color", c, { shouldDirty: true });
              }}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {project ? "Save changes" : "Create project"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NewProjectButton({ slug, clients }: { slug: string; clients: ClientOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> New project
      </Button>
      {open ? (
        <ProjectDialog slug={slug} clients={clients} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
