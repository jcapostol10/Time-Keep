"use client";

import { parseDuration, type AssignmentInput } from "@timekeep/core";
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
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Switch } from "@timekeep/ui/components/switch";
import { Textarea } from "@timekeep/ui/components/textarea";
import { useState } from "react";

import type { AssignmentDTO } from "@/lib/schedule-types";

import { ProjectPicker } from "../tracker/project-picker";
import { hm, useScheduleWrites } from "./use-schedule";

/** What the dialog opens with: an assignment to edit, or a new one's person and dates. */
export type AssignmentDialogMode =
  | { kind: "edit"; assignment: AssignmentDTO }
  | { kind: "new"; userId: string; startDate: string; endDate: string };

const REPEATS = [
  { value: "0", label: "No repeat" },
  { value: "1", label: "Every week" },
  { value: "2", label: "Every 2 weeks" },
  { value: "3", label: "Every 3 weeks" },
  { value: "4", label: "Every 4 weeks" },
];

function minutesOf(text: string): number | null {
  const seconds = parseDuration(text);
  return seconds === null || seconds <= 0 ? null : Math.round(seconds / 60);
}

/**
 * Add or edit an assignment (Phase 7a): a person, a project and task, the
 * dates, hours per day or a total, non-working days, a weekly repeat and a
 * note. The server checks the person can see the project and the amount
 * fits; its messages land under their fields.
 */
export function AssignmentDialog({
  slug,
  mode,
  people,
  onClose,
}: {
  slug: string;
  mode: AssignmentDialogMode;
  people: { userId: string; name: string }[];
  onClose: () => void;
}) {
  const writes = useScheduleWrites(slug, { form: true });
  const a = mode.kind === "edit" ? mode.assignment : null;
  const [userId, setUserId] = useState(a?.userId ?? (mode.kind === "new" ? mode.userId : ""));
  const [selection, setSelection] = useState({
    projectId: a?.project?.id ?? null,
    taskId: a?.task?.id ?? null,
  });
  const [startDate, setStartDate] = useState(
    a?.startDate ?? (mode.kind === "new" ? mode.startDate : ""),
  );
  const [endDate, setEndDate] = useState(a?.endDate ?? (mode.kind === "new" ? mode.endDate : ""));
  const [hoursMode, setHoursMode] = useState<"PER_DAY" | "TOTAL">(a?.mode ?? "PER_DAY");
  const [perDay, setPerDay] = useState(a?.minutesPerDay ? hm(a.minutesPerDay) : "");
  const [total, setTotal] = useState(a?.totalMinutes ? hm(a.totalMinutes) : "");
  const [nonWorking, setNonWorking] = useState(a?.includeNonWorking ?? false);
  const [repeat, setRepeat] = useState(String(a?.repeatWeeks ?? 0));
  const [until, setUntil] = useState(a?.repeatUntil ?? "");
  const [note, setNote] = useState(a?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    const problems: Record<string, string> = {};
    if (!selection.projectId) problems.projectId = "Pick a project.";
    const minutesPerDay = hoursMode === "PER_DAY" ? minutesOf(perDay) : null;
    const totalMinutes = hoursMode === "TOTAL" ? minutesOf(total) : null;
    if (hoursMode === "PER_DAY" && minutesPerDay === null) {
      problems.minutesPerDay = "Enter the hours per day.";
    }
    if (hoursMode === "TOTAL" && totalMinutes === null) {
      problems.totalMinutes = "Enter the total hours.";
    }
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    const repeatWeeks = Number(repeat) || null;
    const input: AssignmentInput = {
      userId,
      projectId: selection.projectId!,
      taskId: selection.taskId,
      startDate,
      endDate,
      mode: hoursMode,
      minutesPerDay,
      totalMinutes,
      includeNonWorking: nonWorking,
      note,
      repeatWeeks,
      repeatUntil: repeatWeeks ? until || null : null,
    };
    const result = a ? await writes.update(a.id, input) : await writes.create(input);
    if (result.ok) {
      onClose();
      return;
    }
    setErrors(
      Object.fromEntries(Object.entries(result.fieldErrors).map(([k, v]) => [k, v[0] ?? ""])),
    );
  }

  async function remove() {
    if (!a) return;
    const result = await writes.remove(a.id);
    if (result.ok) onClose();
  }

  const error = (key: string) =>
    errors[key] ? <p className="text-destructive text-sm">{errors[key]}</p> : null;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{a ? "Edit assignment" : "Add assignment"}</DialogTitle>
          </DialogHeader>
          {a?.repeatWeeks ? (
            <p className="text-muted-foreground text-sm">
              This assignment repeats: changes apply to the whole series.
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="assignment-person">Person</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="assignment-person" aria-label="Person" className="w-full">
                <SelectValue placeholder="Pick a person" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.userId} value={p.userId}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error("userId")}
          </div>
          <div className="space-y-2">
            <Label>Project</Label>
            <div>
              <ProjectPicker
                slug={slug}
                value={selection}
                onChange={setSelection}
                invalid={Boolean(errors.projectId || errors.taskId)}
                current={
                  a?.project && a.project.id === selection.projectId
                    ? {
                        project: { name: a.project.name, color: a.project.color },
                        task:
                          a.task && a.task.id === selection.taskId ? { name: a.task.name } : null,
                      }
                    : null
                }
              />
            </div>
            {error("projectId")}
            {error("taskId")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="assignment-start">Start</Label>
              <Input
                id="assignment-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
              {error("startDate")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment-end">End</Label>
              <Input
                id="assignment-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
              {error("endDate")}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Hours</Label>
            <RadioGroup
              value={hoursMode}
              onValueChange={(v) => setHoursMode(v as "PER_DAY" | "TOTAL")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="PER_DAY" aria-label="Per day" /> Per day
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="TOTAL" aria-label="Total" /> Total
              </label>
            </RadioGroup>
          </div>
          {hoursMode === "PER_DAY" ? (
            <div className="space-y-2">
              <Label htmlFor="assignment-per-day">Hours per day</Label>
              <Input
                id="assignment-per-day"
                value={perDay}
                onChange={(e) => setPerDay(e.target.value)}
                placeholder="8"
                inputMode="decimal"
              />
              {error("minutesPerDay")}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="assignment-total">Total hours</Label>
              <Input
                id="assignment-total"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="20"
                inputMode="decimal"
              />
              {error("totalMinutes")}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="assignment-non-working">Include non-working days</Label>
            <Switch
              id="assignment-non-working"
              checked={nonWorking}
              onCheckedChange={setNonWorking}
              aria-label="Include non-working days"
            />
          </div>
          {error("includeNonWorking")}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="assignment-repeat">Repeat</Label>
              <Select value={repeat} onValueChange={setRepeat}>
                <SelectTrigger id="assignment-repeat" aria-label="Repeat" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEATS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {repeat !== "0" ? (
              <div className="space-y-2">
                <Label htmlFor="assignment-until">Until</Label>
                <Input
                  id="assignment-until"
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
                {error("repeatUntil")}
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-note">Note</Label>
            <Textarea
              id="assignment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
            />
          </div>
          <DialogFooter className="gap-2">
            {a ? (
              <Button type="button" variant="outline" onClick={() => void remove()}>
                Delete
              </Button>
            ) : null}
            <Button type="submit" disabled={writes.busy}>
              Save assignment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
