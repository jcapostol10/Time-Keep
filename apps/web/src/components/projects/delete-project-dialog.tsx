"use client";

import type { DeleteProjectMode } from "@timekeep/core";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@timekeep/ui/components/alert-dialog";
import { Button } from "@timekeep/ui/components/button";
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ProjectListItem } from "@/lib/catalog-types";
import { countProjectEntriesAction, deleteProjectAction } from "@/server/actions/projects";

const NO_PROJECT = "__none__";

/**
 * Deleting a project with time means choosing what happens to that time:
 * move it to another project (or none) or delete it too. The parent keys
 * this component by project, so its state starts fresh for each one.
 */
export function DeleteProjectDialog({
  slug,
  project,
  others,
  onClose,
  onDeleted,
}: {
  slug: string;
  project: ProjectListItem | null;
  /** Active projects the entries could move to. */
  others: ProjectListItem[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [mode, setMode] = useState<"reassign" | "delete">("reassign");
  const [target, setTarget] = useState<string>(NO_PROJECT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void countProjectEntriesAction(slug, project.id).then((result) => {
      if (!cancelled) setCount(result.ok ? result.data : 0);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, project]);

  async function confirm() {
    if (!project) return;
    const payload: DeleteProjectMode =
      count === 0 || mode === "delete"
        ? { mode: "delete" }
        : { mode: "reassign", projectId: target === NO_PROJECT ? null : target };
    setBusy(true);
    const result = await deleteProjectAction(slug, project.id, payload);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${project.name} deleted`);
    onDeleted();
  }

  const entryText =
    count === null ? "Counting its entries…" : count === 1 ? "1 entry" : `${count} entries`;

  return (
    <AlertDialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project?</AlertDialogTitle>
          <AlertDialogDescription>
            {project?.name} has {entryText}. Its tasks and favourites go with it. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {count !== null && count > 0 ? (
          <RadioGroup
            aria-label="What happens to its entries"
            value={mode}
            onValueChange={(v) => setMode(v as "reassign" | "delete")}
          >
            <label className="flex items-start gap-3">
              <RadioGroupItem
                value="reassign"
                aria-label="Move its entries to"
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">Move its entries to</span>
                <Select value={target} onValueChange={setTarget} disabled={mode !== "reassign"}>
                  <SelectTrigger aria-label="Project" className="mt-2 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROJECT}>No project</SelectItem>
                    {others.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.clientName ? ` · ${p.clientName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <RadioGroupItem value="delete" aria-label="Delete its entries" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Delete its entries</span>
                <span className="text-muted-foreground block text-xs">
                  The time disappears from every report.
                </span>
              </span>
            </label>
          </RadioGroup>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={busy || count === null}>
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Delete project
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
