"use client";

import { type ProjectInput, projectInputSchema } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Form } from "@timekeep/ui/components/form";
import { Switch } from "@timekeep/ui/components/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import type { ProjectDetail, ProjectListItem } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import { updateProjectAction } from "@/server/actions/projects";

import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectFormFields, type ProjectFormValues } from "./project-form-fields";
import type { ClientOption } from "./projects-toolbar";

export function ProjectSettingsTab({
  slug,
  project,
  clients,
  others,
}: {
  slug: string;
  project: ProjectDetail;
  clients: ClientOption[];
  others: ProjectListItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const form = useForm<ProjectFormValues, unknown, ProjectInput>({
    resolver: zodResolver(projectInputSchema),
    defaultValues: {
      name: project.name,
      clientId: project.clientId,
      color: project.color,
      billable: project.billable,
      visibility: project.visibility,
      note: project.note,
    },
  });
  const color = useWatch({ control: form.control, name: "color" }) ?? project.color;

  async function onSubmit(values: ProjectInput) {
    const result = await updateProjectAction(slug, project.id, values);
    if (!result.ok) {
      if (/already exists/.test(result.error)) form.setError("name", { message: result.error });
      else toast.error(result.error);
      return;
    }
    toast.success("Project updated");
    router.refresh();
  }

  function patch(input: Record<string, unknown>, success: string) {
    startTransition(async () => {
      const result = await updateProjectAction(slug, project.id, input);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  const selectableClients = clients.filter((c) => !c.archived || c.id === project.clientId);

  return (
    <div className="max-w-xl space-y-8">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <ProjectFormFields
            form={form}
            clients={selectableClients}
            color={color}
            onColorChange={(c) => form.setValue("color", c, { shouldDirty: true })}
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Save changes
          </Button>
        </form>
      </Form>

      <div className="flex items-center justify-between rounded-md border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Use as template</p>
          <p className="text-muted-foreground text-xs">
            Phase 4 lets you start new projects from templates.
          </p>
        </div>
        <Switch
          aria-label="Use as template"
          checked={project.isTemplate}
          disabled={pending}
          onCheckedChange={(checked) =>
            patch(
              { isTemplate: checked },
              checked ? "Marked as a template" : "No longer a template",
            )
          }
        />
      </div>

      <section className="space-y-3 rounded-md border border-dashed p-4">
        <h2 className="text-base font-semibold">Archive or delete</h2>
        <p className="text-muted-foreground text-sm">
          An archived project keeps its entries and takes no new time. Deleting it asks what to do
          with its entries.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              patch(
                { archived: !project.archived },
                project.archived ? "Project unarchived" : "Project archived",
              )
            }
          >
            {project.archived ? "Unarchive project" : "Archive project"}
          </Button>
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            Delete project
          </Button>
        </div>
      </section>

      <DeleteProjectDialog
        key={deleting ? project.id : "closed"}
        slug={slug}
        project={deleting ? project : null}
        others={others}
        onClose={() => setDeleting(false)}
        onDeleted={() => router.push(workspaceRoutes.projects(slug))}
      />
    </div>
  );
}
