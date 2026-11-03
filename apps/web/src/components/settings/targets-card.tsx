"use client";

import { formatDuration, type TargetKind, type TargetPeriod } from "@timekeep/core";
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
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import { Switch } from "@timekeep/ui/components/switch";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { TargetRuleDTO } from "@/lib/target-types";
import { deleteTargetRuleAction, saveTargetRuleAction } from "@/server/actions/targets";

import {
  type Assignees,
  AssigneesField,
  assigneesLabel,
  type Option,
} from "../time-off/assignees-field";

const KIND_LABELS: Record<TargetKind, string> = {
  UNDER: "Tracked too little",
  OVER: "Tracked too much",
};
const PERIOD_LABELS: Record<TargetPeriod, string> = { DAY: "In a day", WEEK: "In a week" };

const hoursText = (minutes: number) =>
  minutes % 60 === 0
    ? String(minutes / 60)
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Target rules (Phase 5b): reminders to people who tracked too little and alerts
 * to admins and managers about too much, sent by the daily job.
 */
export function TargetsCard({
  slug,
  rules,
  people,
  groups,
}: {
  slug: string;
  rules: TargetRuleDTO[];
  people: Option[];
  groups: Option[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<TargetRuleDTO | "new" | null>(null);

  async function remove(rule: TargetRuleDTO) {
    const result = await deleteTargetRuleAction(slug, rule.id);
    if (!result.ok) toast.error(result.error);
    else toast.success("Target deleted");
    router.refresh();
  }

  return (
    <section aria-labelledby="targets" className="mt-10 max-w-xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="targets" className="text-lg font-semibold">
          Targets
        </h2>
        <Button size="sm" onClick={() => setEditing("new")}>
          Add target
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Reminders are sent the next morning. People who tracked too little get an email they can
        mute; owners, admins and managers hear about too much.
      </p>
      {rules.length === 0 ? (
        <p className="text-muted-foreground text-sm">No targets yet.</p>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Targets">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <span>
                <span className="font-medium">
                  {KIND_LABELS[r.kind]}: {r.kind === "UNDER" ? "under" : "over"}{" "}
                  {formatDuration(r.thresholdMinutes * 60, "hh:mm")}{" "}
                  {PERIOD_LABELS[r.period].toLowerCase()}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {assigneesLabel(r, people, groups)}
                  {r.active ? "" : " · paused"}
                </span>
              </span>
              <span className="space-x-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(r)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <TargetDialog
          slug={slug}
          rule={editing === "new" ? null : editing}
          people={people}
          groups={groups}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function TargetDialog({
  slug,
  rule,
  people,
  groups,
  onClose,
}: {
  slug: string;
  rule: TargetRuleDTO | null;
  people: Option[];
  groups: Option[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<TargetKind>(rule?.kind ?? "UNDER");
  const [period, setPeriod] = useState<TargetPeriod>(rule?.period ?? "DAY");
  const [threshold, setThreshold] = useState(rule ? hoursText(rule.thresholdMinutes) : "");
  const [active, setActive] = useState(rule?.active ?? true);
  const [assignees, setAssignees] = useState<Assignees>({
    everyone: rule?.everyone ?? true,
    userIds: rule?.userIds ?? [],
    groupIds: rule?.groupIds ?? [],
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const result = await saveTargetRuleAction(
        slug,
        { kind, period, threshold, active, ...assignees },
        rule?.id,
      );
      if (!result.ok) {
        toast.error(result.fieldErrors?.threshold?.[0] ?? result.error);
        return;
      }
      toast.success(rule ? "Target saved" : "Target added");
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

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
            <DialogTitle>{rule ? "Edit target" : "New target"}</DialogTitle>
            <DialogDescription>Reminders are sent the next morning.</DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as TargetKind)}
            className="flex flex-wrap gap-4"
          >
            {(Object.keys(KIND_LABELS) as TargetKind[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={k} aria-label={KIND_LABELS[k]} /> {KIND_LABELS[k]}
              </label>
            ))}
          </RadioGroup>
          <RadioGroup
            value={period}
            onValueChange={(v) => setPeriod(v as TargetPeriod)}
            className="flex flex-wrap gap-4"
          >
            {(Object.keys(PERIOD_LABELS) as TargetPeriod[]).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={p} aria-label={PERIOD_LABELS[p]} /> {PERIOD_LABELS[p]}
              </label>
            ))}
          </RadioGroup>
          <div className="space-y-2">
            <Label htmlFor="target-hours">Hours</Label>
            <Input
              id="target-hours"
              inputMode="decimal"
              className="w-28"
              placeholder="8"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Active</span>
            <Switch aria-label="Active" checked={active} onCheckedChange={setActive} />
          </label>
          <AssigneesField
            value={assignees}
            onChange={setAssignees}
            people={people}
            groups={groups}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !threshold.trim()}>
              Save target
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
