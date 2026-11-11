"use client";

import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
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
import { useState } from "react";

import type { MilestoneDTO } from "@/lib/schedule-types";

import { useScheduleWrites } from "./use-schedule";

/** Add or edit a milestone (decision 16): a project the viewer manages, a date and a name. */
export function MilestoneDialog({
  slug,
  milestone,
  projects,
  defaultDate,
  onClose,
}: {
  slug: string;
  milestone: MilestoneDTO | null;
  projects: { id: string; name: string }[];
  defaultDate: string;
  onClose: () => void;
}) {
  const writes = useScheduleWrites(slug, { form: true });
  const [projectId, setProjectId] = useState(milestone?.projectId ?? "");
  const [date, setDate] = useState(milestone?.date ?? defaultDate);
  const [name, setName] = useState(milestone?.name ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    const input = { projectId, date, name };
    const result = milestone
      ? await writes.updateMilestone(milestone.id, input)
      : await writes.createMilestone(input);
    if (result.ok) onClose();
    else {
      setErrors(
        Object.fromEntries(Object.entries(result.fieldErrors).map(([k, v]) => [k, v[0] ?? ""])),
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{milestone ? "Edit milestone" : "Add milestone"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="milestone-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="milestone-project" aria-label="Project" className="w-full">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.projectId ? (
              <p className="text-destructive text-sm">{errors.projectId}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="milestone-date">Date</Label>
            <Input
              id="milestone-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="milestone-name">Name</Label>
            <Input
              id="milestone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
            {errors.name ? <p className="text-destructive text-sm">{errors.name}</p> : null}
          </div>
          <DialogFooter className="gap-2">
            {milestone ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if ((await writes.deleteMilestone(milestone.id)).ok) onClose();
                }}
              >
                Delete
              </Button>
            ) : null}
            <Button type="submit" disabled={writes.busy}>
              Save milestone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
