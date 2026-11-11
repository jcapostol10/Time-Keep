"use client";

import type { AssignmentInput, AssignmentPatch, MilestoneInput } from "@timekeep/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";
import { fetchJson } from "@/lib/fetch-json";
import type { ScheduleDTO } from "@/lib/schedule-types";
import {
  copyAssignmentAction,
  createAssignmentAction,
  createMilestoneAction,
  deleteAssignmentAction,
  deleteMilestoneAction,
  discardScheduleAction,
  publishScheduleAction,
  splitAssignmentAction,
  updateAssignmentAction,
  updateMilestoneAction,
} from "@/server/actions/schedule";

import { scheduleKeys, scheduleUrls } from "../tracker/query-keys";
import { refusalToast, scheduleParams } from "./schedule-model";

/** The working plan for a range (planners). */
export function useTeamSchedule(slug: string, range: { from: string; to: string }) {
  const params = scheduleParams(range);
  return useQuery({
    queryKey: scheduleKeys.team(slug, params),
    queryFn: () => fetchJson<ScheduleDTO>(scheduleUrls.team(slug, params)),
    placeholderData: (previous) => previous,
  });
}

/** The viewer's own published plan for a range. */
export function useMySchedule(slug: string, from: string | null, to: string | null) {
  return useQuery({
    queryKey: scheduleKeys.mine(slug, from ?? "", to ?? ""),
    queryFn: () => fetchJson<ScheduleDTO>(scheduleUrls.mine(slug, from!, to!)),
    enabled: from !== null && to !== null,
  });
}

/**
 * The schedule's writes: each runs its action, toasts a refusal and
 * refetches every schedule view. A form gets the field errors back.
 */
export function useScheduleWrites(slug: string, opts: { form?: boolean } = {}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function run<T>(
    call: () => Promise<ActionResult<T>>,
    done?: string,
  ): Promise<{ ok: true; data: T } | { ok: false; fieldErrors: Record<string, string[]> }> {
    setBusy(true);
    try {
      const result = await call();
      const refusal = refusalToast(result, opts.form ?? false);
      if (refusal) toast.error(refusal);
      if (!result.ok) return { ok: false, fieldErrors: result.fieldErrors ?? {} };
      await qc.invalidateQueries({ queryKey: scheduleKeys.all(slug) });
      if (done) toast.success(done);
      return { ok: true, data: result.data };
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    create: (input: AssignmentInput) =>
      run(() => createAssignmentAction(slug, input), "Assignment saved"),
    update: (id: string, patch: AssignmentPatch, done = "Assignment saved") =>
      run(() => updateAssignmentAction(slug, id, patch), done),
    remove: (id: string) => run(() => deleteAssignmentAction(slug, id), "Assignment deleted"),
    copy: (id: string, to: { userId?: string; startDate: string }) =>
      run(() => copyAssignmentAction(slug, id, to), "Assignment copied"),
    split: (id: string, at: string) =>
      run(() => splitAssignmentAction(slug, id, { at }), "Assignment split"),
    publish: () => run(() => publishScheduleAction(slug), "Schedule published"),
    discard: () => run(() => discardScheduleAction(slug), "Changes discarded"),
    createMilestone: (input: MilestoneInput) =>
      run(() => createMilestoneAction(slug, input), "Milestone saved"),
    updateMilestone: (id: string, patch: Partial<MilestoneInput>) =>
      run(() => updateMilestoneAction(slug, id, patch), "Milestone saved"),
    deleteMilestone: (id: string) =>
      run(() => deleteMilestoneAction(slug, id), "Milestone deleted"),
  };
}

/** "4:00", "1:30" — the schedule prints hours as h:mm. */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** A bar's label: project · task · the amount. */
export function barLabel(a: {
  project: { name: string } | null;
  task: { name: string } | null;
  mode: "PER_DAY" | "TOTAL";
  minutesPerDay: number | null;
  totalMinutes: number | null;
}): string {
  const name = a.project ? a.project.name : "Another project";
  const amount =
    a.mode === "PER_DAY" ? `${hm(a.minutesPerDay ?? 0)} a day` : `${hm(a.totalMinutes ?? 0)} total`;
  return [name, a.task?.name, amount].filter(Boolean).join(" · ");
}
