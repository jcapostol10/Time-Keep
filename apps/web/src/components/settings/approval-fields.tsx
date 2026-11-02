"use client";

import {
  APPROVAL_PERIOD_LABELS,
  APPROVAL_PERIODS,
  APPROVAL_REVIEWER_LABELS,
  APPROVAL_REVIEWERS,
  type LockMode,
  LOCK_MODES,
  type WorkspaceSettingsInput,
} from "@timekeep/core";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@timekeep/ui/components/form";
import { Input } from "@timekeep/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Switch } from "@timekeep/ui/components/switch";
import { useFormContext, useWatch } from "react-hook-form";

import { SettingsSection } from "./rules-fields";

/**
 * Phase 5a: approvals (decisions 2-5) and lock dates (decision 6). Periods
 * and lock dates are in the workspace timezone above.
 */

const LOCK_LABELS: Record<LockMode, string> = {
  OFF: "Off",
  FIXED: "Before a date",
  ROLLING: "Older than a number of days",
};

export function ApprovalFields() {
  const form = useFormContext<WorkspaceSettingsInput>();
  const enabled = useWatch({ control: form.control, name: "approvalEnabled" });
  const lockMode = useWatch({ control: form.control, name: "lockMode" });

  return (
    <div className="space-y-10">
      <SettingsSection
        id="approval"
        title="Approval"
        description="People submit each period of their time for approval. Submitted and approved time is read-only for them; owners and admins change it only with a note, which the period's history keeps."
      >
        <FormField
          control={form.control}
          name="approvalEnabled"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="font-normal">Require approval</FormLabel>
            </FormItem>
          )}
        />
        <div className="grid items-start gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="approvalPeriod"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Approval period</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!enabled}>
                  <FormControl>
                    <SelectTrigger aria-label="Approval period" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {APPROVAL_PERIODS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {APPROVAL_PERIOD_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Weeks start on the workspace&apos;s first day of the week.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="approvalReviewers"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Who approves</FormLabel>
                {/* Also decides who reviews time off (Phase 5b), so it stays editable. */}
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger aria-label="Who approves" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {APPROVAL_REVIEWERS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {APPROVAL_REVIEWER_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Also decides who approves time off. Managers never approve their own.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="lock"
        title="Lock entries"
        description="Members and managers cannot add, change or delete time that starts before the lock. Owners and admins are never locked."
      >
        <FormField
          control={form.control}
          name="lockMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">Lock entries</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-label="Lock entries"
                  className="gap-3"
                >
                  {LOCK_MODES.map((mode) => (
                    <FormItem key={mode} className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <RadioGroupItem value={mode} />
                      </FormControl>
                      <FormLabel className="font-normal">{LOCK_LABELS[mode]}</FormLabel>
                    </FormItem>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {lockMode === "FIXED" ? (
          <FormField
            control={form.control}
            name="lockDate"
            render={({ field }) => (
              <FormItem className="max-w-xs">
                <FormLabel>Lock date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormDescription>Entries before this day are locked.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {lockMode === "ROLLING" ? (
          <FormField
            control={form.control}
            name="lockDays"
            render={({ field }) => (
              <FormItem className="max-w-xs">
                <FormLabel>Days</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </FormControl>
                <FormDescription>Entries older than this many days are locked.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
      </SettingsSection>
    </div>
  );
}
