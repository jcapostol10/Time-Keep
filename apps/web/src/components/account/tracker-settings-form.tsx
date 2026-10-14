"use client";

import {
  DEFAULT_IDLE_DETECTION_MINUTES,
  trackerSettingsSchema,
  type TrackerSettingsInput,
  WEEK_START_DAYS,
  WEEKDAY_LABELS,
  type WeekStartDay,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@timekeep/ui/components/form";
import { Input } from "@timekeep/ui/components/input";
import { Switch } from "@timekeep/ui/components/switch";
import { cn } from "@timekeep/ui/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { ensureIdlePermission, ensureNotificationPermission } from "@/lib/notifications";
import { updateTrackerSettingsAction } from "@/server/actions/tracker-settings";

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function numberValue(value: string): number {
  return value === "" ? Number.NaN : Number(value);
}

async function askNotifications() {
  const permission = await ensureNotificationPermission();
  if (permission === "denied") {
    toast.warning("Notifications are blocked in this browser, so reminders will show in the app.");
  }
}

export function TrackerSettingsForm({ defaultValues }: { defaultValues: TrackerSettingsInput }) {
  const router = useRouter();
  const form = useForm<TrackerSettingsInput>({
    resolver: zodResolver(trackerSettingsSchema),
    defaultValues,
  });
  const idleMinutes = useWatch({ control: form.control, name: "idleDetectionMinutes" });
  const pomodoro = useWatch({ control: form.control, name: "pomodoroEnabled" });
  const reminders = useWatch({ control: form.control, name: "remindersEnabled" });

  async function onSubmit(values: TrackerSettingsInput) {
    const result = await updateTrackerSettingsAction(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Timer settings saved");
    form.reset(result.data);
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl space-y-8" noValidate>
        <fieldset className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <legend className="text-sm font-medium">Idle detection</legend>
              <p className="text-muted-foreground text-sm">
                When you come back after being away while a timer runs, ask whether to keep or
                discard the idle time.
              </p>
            </div>
            <Switch
              aria-label="Detect idle time"
              checked={idleMinutes !== null}
              onCheckedChange={(on) => {
                form.setValue("idleDetectionMinutes", on ? DEFAULT_IDLE_DETECTION_MINUTES : null, {
                  shouldDirty: true,
                });
                if (on) void ensureIdlePermission();
              }}
            />
          </div>
          {idleMinutes !== null ? (
            <FormField
              control={form.control}
              name="idleDetectionMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Idle after (minutes)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={240}
                      className="w-28"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(numberValue(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <legend className="text-sm font-medium">Pomodoro</legend>
              <p className="text-muted-foreground text-sm">
                Notify me at the end of each focus block and break while a timer runs.
              </p>
            </div>
            <FormField
              control={form.control}
              name="pomodoroEnabled"
              render={({ field }) => (
                <Switch
                  aria-label="Pomodoro notifications"
                  checked={field.value}
                  onCheckedChange={(on) => {
                    field.onChange(on);
                    if (on) void askNotifications();
                  }}
                />
              )}
            />
          </div>
          {pomodoro ? (
            <div className="flex flex-wrap gap-4">
              <FormField
                control={form.control}
                name="pomodoroFocusMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Focus (minutes)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={180}
                        className="w-28"
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(e) => field.onChange(numberValue(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pomodoroBreakMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Break (minutes)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        className="w-28"
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(e) => field.onChange(numberValue(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <legend className="text-sm font-medium">Reminders</legend>
              <p className="text-muted-foreground text-sm">
                Remind me when no timer is running during my working hours (at most once an hour,
                while TimeKeep is open).
              </p>
            </div>
            <FormField
              control={form.control}
              name="remindersEnabled"
              render={({ field }) => (
                <Switch
                  aria-label="Tracking reminders"
                  checked={field.value}
                  onCheckedChange={(on) => {
                    field.onChange(on);
                    if (on) void askNotifications();
                  }}
                />
              )}
            />
          </div>
          {reminders ? (
            <>
              <FormField
                control={form.control}
                name="reminderDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Working days</FormLabel>
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Working days">
                      {WEEK_START_DAYS.map((day) => {
                        const on = field.value.includes(day);
                        return (
                          <Button
                            key={day}
                            type="button"
                            size="sm"
                            variant={on ? "default" : "outline"}
                            aria-pressed={on}
                            aria-label={WEEKDAY_LABELS[day]}
                            className={cn("w-12")}
                            onClick={() =>
                              field.onChange(
                                (on
                                  ? field.value.filter((d) => d !== day)
                                  : [...field.value, day]
                                ).sort() as WeekStartDay[],
                              )
                            }
                          >
                            {WEEKDAY_LABELS[day].slice(0, 3)}
                          </Button>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-wrap items-start gap-4">
                <FormField
                  control={form.control}
                  name="reminderStartMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          className="w-32"
                          value={minutesToTime(field.value)}
                          onChange={(e) => {
                            const m = timeToMinutes(e.target.value);
                            if (m !== null) field.onChange(m);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reminderEndMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>To</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          className="w-32"
                          value={minutesToTime(field.value)}
                          onChange={(e) => {
                            const m = timeToMinutes(e.target.value);
                            if (m !== null) field.onChange(m === 0 ? 1440 : m);
                          }}
                        />
                      </FormControl>
                      <FormDescription>In your timezone.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </>
          ) : null}
        </fieldset>

        <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
          {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Save timer settings
        </Button>
      </form>
    </Form>
  );
}
