"use client";

import { ENTRY_DESCRIPTION_MAX, type TimesheetRowKey } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
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
import { useId, useState } from "react";

import { ProjectPicker, type ProjectSelection } from "../tracker/project-picker";

/** Picks a project/task and an optional description for a new grid row. */
export function AddRowDialog({
  slug,
  open,
  onOpenChange,
  onAdd,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (row: TimesheetRowKey) => void;
}) {
  const [selection, setSelection] = useState<ProjectSelection>({ projectId: null, taskId: null });
  const [description, setDescription] = useState("");
  const id = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add row</DialogTitle>
          <DialogDescription>
            New entries typed into the row get these details. Rows without time are not saved.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd({ ...selection, description: description.trim() });
          }}
        >
          <div className="space-y-2">
            <Label>Project and task</Label>
            <div>
              <ProjectPicker slug={slug} value={selection} onChange={setSelection} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={id}>Description</Label>
            <Input
              id={id}
              value={description}
              maxLength={ENTRY_DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add row</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
