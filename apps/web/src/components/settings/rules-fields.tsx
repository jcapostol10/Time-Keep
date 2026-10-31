"use client";

import {
  type CatalogType,
  CREATOR_SETTINGS,
  type CreatorSetting,
  type Page,
  PAGES,
  REQUIRED_FIELD_LABELS,
  REQUIRED_FIELDS,
  ROUNDING_MODES,
  ROUNDING_STEPS,
  type RoundingMode,
  TASK_VISIBILITY,
  type TaskVisibility,
  type WorkspaceSettingsInput,
} from "@timekeep/core";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@timekeep/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Switch } from "@timekeep/ui/components/switch";
import { useFormContext, useWatch } from "react-hook-form";

/**
 * The Phase 4b rule sections of the workspace settings form. Rendered inside
 * the form's <Form> provider; every control writes a field of
 * `workspaceSettingsSchema`, so one Save sends all of them.
 */

const ROUNDING_LABELS: Record<RoundingMode, string> = {
  off: "Off",
  up: "Up",
  down: "Down",
  nearest: "Nearest",
};

const PAGE_LABELS: Record<Page, string> = {
  projects: "Projects",
  team: "Team",
  reports: "Reports",
};

const CREATOR_LABELS: Record<CreatorSetting, string> = {
  admins: "Admins",
  managers: "Admins and managers",
  everyone: "Everyone",
};

const TASK_VISIBILITY_LABELS: Record<TaskVisibility, string> = {
  EVERYONE: "Everyone",
  BY_GROUP: "By group",
};

// Tasks are not here: owners, admins and a project's managers create them (decision 11).
const CREATOR_FIELDS: {
  name: "projectCreators" | "clientCreators" | "tagCreators";
  type: CatalogType;
  label: string;
}[] = [
  { name: "projectCreators", type: "project", label: "Who can create projects" },
  { name: "clientCreators", type: "client", label: "Who can create clients" },
  { name: "tagCreators", type: "tag", label: "Who can create tags" },
];

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="space-y-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

function toggled<T extends string>(list: T[], item: T, on: boolean): T[] {
  return on ? [...new Set([...list, item])] : list.filter((x) => x !== item);
}

export function RulesFields() {
  const form = useFormContext<WorkspaceSettingsInput>();
  const roundingMode = useWatch({ control: form.control, name: "roundingMode" });

  return (
    <div className="space-y-10">
      <Section
        id="rounding"
        title="Rounding"
        description="Rounds each entry in reports, exports and shared links. The tracker, timesheet and calendar always show real time."
      >
        <div className="grid items-start gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="roundingMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Round durations</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger aria-label="Rounding" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ROUNDING_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {ROUNDING_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="roundingMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>To the nearest</FormLabel>
                <Select
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                  disabled={roundingMode === "off"}
                >
                  <FormControl>
                    <SelectTrigger aria-label="Rounding step" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ROUNDING_STEPS.map((step) => (
                      <SelectItem key={step} value={String(step)}>
                        {step} min
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </Section>

      <Section
        id="visibility"
        title="Who can see what"
        description="Members always see their own time. Owners, admins and managers are never restricted here."
      >
        <FormField
          control={form.control}
          name="hiddenPages"
          render={({ field }) => (
            <div className="space-y-3">
              {PAGES.map((page) => (
                <FormItem key={page} className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value.includes(page)}
                      onCheckedChange={(on) =>
                        field.onChange(toggled(field.value, page, on === true))
                      }
                    />
                  </FormControl>
                  <FormLabel className="font-normal">
                    Hide {PAGE_LABELS[page]} from members
                  </FormLabel>
                </FormItem>
              ))}
              <FormMessage />
            </div>
          )}
        />
        <FormField
          control={form.control}
          name="membersSeeTeamTime"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(on) => field.onChange(on === true)}
                />
              </FormControl>
              <FormLabel className="font-normal">
                Members see everyone&apos;s time (durations only)
              </FormLabel>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="taskVisibility"
          render={({ field }) => (
            <FormItem className="max-w-xs">
              <FormLabel>Task visibility</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger aria-label="Task visibility" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TASK_VISIBILITY.map((v) => (
                    <SelectItem key={v} value={v}>
                      {TASK_VISIBILITY_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                By group: members see and track only the tasks of their groups, and must pick one on
                a project that has them. Owners and admins see every task.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </Section>

      <Section
        id="creators"
        title="Who can create"
        description="Owners and admins always can. Tasks are created by owners, admins and a project's managers."
      >
        <p className="text-sm">
          <span className="font-medium">Tasks:</span> Admins and project managers
        </p>
        <div className="grid items-start gap-6 sm:grid-cols-2">
          {CREATOR_FIELDS.map(({ name, type, label }) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="capitalize">{type}s</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label={label} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CREATOR_SETTINGS.map((setting) => (
                        <SelectItem key={setting} value={setting}>
                          {CREATOR_LABELS[setting]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      </Section>

      <Section
        id="required-fields"
        title="Required fields"
        description="Checked when an entry is stopped or saved, never when a timer starts. A task is required only on projects that have tasks; breaks are exempt."
      >
        <FormField
          control={form.control}
          name="requiredFields"
          render={({ field }) => (
            <fieldset className="space-y-3">
              <legend className="sr-only">Required fields</legend>
              {REQUIRED_FIELDS.map((rf) => (
                <FormItem key={rf} className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value.includes(rf)}
                      onCheckedChange={(on) =>
                        field.onChange(toggled(field.value, rf, on === true))
                      }
                    />
                  </FormControl>
                  <FormLabel className="font-normal">{REQUIRED_FIELD_LABELS[rf]}</FormLabel>
                </FormItem>
              ))}
              <FormMessage />
            </fieldset>
          )}
        />
      </Section>

      <Section
        id="force-timer"
        title="Force timer"
        description="Members and managers track with the timer only: no manual entries, and no changes to start, end or duration of their own time. Owners and admins, and time added for someone else, are not affected."
      >
        <FormField
          control={form.control}
          name="forceTimer"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="font-normal">Force timer</FormLabel>
            </FormItem>
          )}
        />
      </Section>

      <Section
        id="breaks"
        title="Breaks"
        description="Lets people track breaks. A break has no project, tags or billing, and reports count work time unless the Type filter says otherwise."
      >
        <FormField
          control={form.control}
          name="allowBreaks"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="font-normal">Allow breaks</FormLabel>
              <FormDescription className="sr-only">
                Shows a Break switch in the timer bar and manual mode.
              </FormDescription>
            </FormItem>
          )}
        />
      </Section>
    </div>
  );
}
