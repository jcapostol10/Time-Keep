"use client";

import { type BulkEntryPatch, ENTRY_DESCRIPTION_MAX } from "@timekeep/core";
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
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Loader2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { BillableToggle } from "./billable-toggle";
import { draftWritesSettled } from "./draft-writes";
import { ProjectPicker, type ProjectSelection } from "./project-picker";
import { TagPicker } from "./tag-picker";
import { useTracker } from "./tracker-provider";

type TagMode = NonNullable<BulkEntryPatch["tags"]>["mode"];

const TAG_MODES: { value: TagMode; label: string }[] = [
  { value: "add", label: "Add" },
  { value: "replace", label: "Replace" },
  { value: "remove", label: "Remove" },
];

/**
 * Bulk edit: each row is a field the person chooses to change; unchecked
 * fields stay as they are. One call applies the patch to every selected
 * entry, or to none (the server explains how many failed and why).
 */
export function BulkEditDialog({
  count,
  open,
  onOpenChange,
  onApply,
}: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (patch: BulkEntryPatch) => Promise<boolean>;
}) {
  const { slug, canCreate } = useTracker();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [changeProject, setChangeProject] = useState(false);
  const [selection, setSelection] = useState<ProjectSelection>({ projectId: null, taskId: null });
  const [changeTags, setChangeTags] = useState(false);
  const [tagMode, setTagMode] = useState<TagMode>("add");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [changeBillable, setChangeBillable] = useState(false);
  const [billable, setBillable] = useState(true);
  const [changeDescription, setChangeDescription] = useState(false);
  const [description, setDescription] = useState("");

  const patch: BulkEntryPatch = {
    ...(changeProject ? { projectId: selection.projectId, taskId: selection.taskId } : {}),
    ...(changeTags ? { tags: { mode: tagMode, tagIds } } : {}),
    ...(changeBillable ? { billable } : {}),
    ...(changeDescription ? { description: description.trim() } : {}),
  };
  const nothing = Object.keys(patch).length === 0;
  // The latest patch once a picker's inline create (a new project or tag) has landed.
  const patchRef = useRef(patch);
  useEffect(() => {
    patchRef.current = patch;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{count === 1 ? "Edit 1 entry" : `Edit ${count} entries`}</DialogTitle>
          <DialogDescription>
            Tick what to change; the rest stays. Every entry is updated, or none.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (nothing) return;
            setBusy(true);
            await draftWritesSettled();
            const ok = await onApply(patchRef.current);
            setBusy(false);
            if (ok) onOpenChange(false);
          }}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-project`}
                checked={changeProject}
                onCheckedChange={(v) => setChangeProject(v === true)}
              />
              <Label htmlFor={`${id}-project`}>Change project</Label>
            </div>
            {changeProject ? (
              <ProjectPicker
                slug={slug}
                value={selection}
                onChange={setSelection}
                canCreate={canCreate.project}
              />
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-tags`}
                checked={changeTags}
                onCheckedChange={(v) => setChangeTags(v === true)}
              />
              <Label htmlFor={`${id}-tags`}>Change tags</Label>
            </div>
            {changeTags ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={tagMode} onValueChange={(v) => setTagMode(v as TagMode)}>
                  <SelectTrigger size="sm" aria-label="Tag mode" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAG_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <TagPicker
                  slug={slug}
                  value={tagIds}
                  onChange={setTagIds}
                  canCreate={canCreate.tag}
                />
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-billable`}
                checked={changeBillable}
                onCheckedChange={(v) => setChangeBillable(v === true)}
              />
              <Label htmlFor={`${id}-billable`}>Change billable</Label>
              {changeBillable ? <BillableToggle value={billable} onChange={setBillable} /> : null}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-description`}
                checked={changeDescription}
                onCheckedChange={(v) => setChangeDescription(v === true)}
              />
              <Label htmlFor={`${id}-description`}>Change description</Label>
            </div>
            {changeDescription ? (
              <Input
                aria-label="New description"
                value={description}
                maxLength={ENTRY_DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Replaces every description"
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={nothing || busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
