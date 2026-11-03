"use client";

import type { Capacity } from "@timekeep/core";
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
import { useState } from "react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "8", "7.5", "7:30": what a person types for hours. */
const hoursText = (minutes: number) =>
  minutes % 60 === 0
    ? String(minutes / 60)
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** Daily hours, weekly hours and working days: Attendance and target rules measure against them. */
export function CapacityDialog({
  name,
  capacity,
  onClose,
  onSave,
}: {
  name: string;
  capacity: Capacity;
  onClose: () => void;
  onSave: (input: {
    dailyHours: string;
    weeklyHours: string;
    workingDays: number[];
  }) => Promise<boolean>;
}) {
  const [daily, setDaily] = useState(hoursText(capacity.dailyMinutes));
  const [weekly, setWeekly] = useState(hoursText(capacity.weeklyMinutes));
  const [days, setDays] = useState<number[]>([...capacity.workingDays]);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void onSave({ dailyHours: daily, weeklyHours: weekly, workingDays: days }).finally(() =>
              setBusy(false),
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Capacity of {name}</DialogTitle>
            <DialogDescription>
              The Attendance report counts overtime and undertime against these hours.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="capacity-daily">Daily hours</Label>
              <Input
                id="capacity-daily"
                inputMode="decimal"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="capacity-weekly">Weekly hours</Label>
              <Input
                id="capacity-weekly"
                inputMode="decimal"
                value={weekly}
                onChange={(e) => setWeekly(e.target.value)}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((label, day) => {
                const on = days.includes(day);
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() =>
                      setDays((prev) =>
                        on ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
                      )
                    }
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
