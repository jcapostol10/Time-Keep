"use client";

import { formatCenti, type TimeOffAccrual, type TimeOffUnit } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
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
import { Skeleton } from "@timekeep/ui/components/skeleton";
import { Switch } from "@timekeep/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { fetchJson } from "@/lib/fetch-json";
import type { PolicyDTO } from "@/lib/time-off-types";
import { archivePolicyAction, savePolicyAction } from "@/server/actions/time-off";

import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";
import { type Assignees, AssigneesField, assigneesLabel, type Option } from "./assignees-field";

const ACCRUALS: { value: TimeOffAccrual; label: string }[] = [
  { value: "NONE", label: "No allowance" },
  { value: "YEARLY", label: "Yearly" },
  { value: "MONTHLY", label: "Monthly" },
];

function grantLabel(p: PolicyDTO): string {
  if (p.accrual === "NONE") return p.allowNegative ? "Unlimited" : "Adjustments only";
  const amount = formatCenti(p.allowanceCenti, p.unit);
  return p.accrual === "YEARLY" ? `${amount} a year` : `${amount} a year, monthly`;
}

/** Owners and admins: the workspace's policies, with archived ones shown apart. */
export function PoliciesTab({
  slug,
  people,
  groups,
}: {
  slug: string;
  people: Option[];
  groups: Option[];
}) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: timeOffKeys.policies(slug),
    queryFn: () =>
      fetchJson<{ policies: PolicyDTO[] }>(timeOffUrls.policies(slug, true)).then(
        (r) => r.policies,
      ),
  });
  const [editing, setEditing] = useState<PolicyDTO | "new" | null>(null);

  async function archive(p: PolicyDTO) {
    const result = await archivePolicyAction(slug, p.id, !p.archived);
    if (!result.ok) toast.error(result.error);
    else toast.success(p.archived ? "Policy restored" : "Policy archived");
    await qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>Add policy</Button>
      </div>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (data ?? []).length === 0 ? (
        <p className="text-muted-foreground py-6 text-sm">
          No policies yet. Add one, like Vacation leave with 15 days a year.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table aria-label="Policies">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Grant</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((p) => (
                <TableRow key={p.id} className={p.archived ? "opacity-60" : undefined}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.archived ? (
                      <Badge variant="outline" className="ml-2">
                        Archived
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{grantLabel(p)}</TableCell>
                  <TableCell>{p.requiresApproval ? "Required" : "Approved on submit"}</TableCell>
                  <TableCell className="max-w-60 truncate">
                    {assigneesLabel(p, people, groups)}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void archive(p)}>
                      {p.archived ? "Restore" : "Archive"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <PolicyDialog
          slug={slug}
          policy={editing === "new" ? null : editing}
          people={people}
          groups={groups}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function PolicyDialog({
  slug,
  policy,
  people,
  groups,
  onClose,
}: {
  slug: string;
  policy: PolicyDTO | null;
  people: Option[];
  groups: Option[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(policy?.name ?? "");
  const [unit, setUnit] = useState<TimeOffUnit>(policy?.unit ?? "DAYS");
  const [accrual, setAccrual] = useState<TimeOffAccrual>(policy?.accrual ?? "YEARLY");
  const [allowance, setAllowance] = useState(
    policy && policy.accrual !== "NONE"
      ? formatCenti(policy.allowanceCenti, policy.unit).split(" ")[0]!
      : "",
  );
  const [requiresApproval, setRequiresApproval] = useState(policy?.requiresApproval ?? true);
  const [allowNegative, setAllowNegative] = useState(policy?.allowNegative ?? false);
  const [assignees, setAssignees] = useState<Assignees>({
    everyone: policy?.everyone ?? true,
    userIds: policy?.userIds ?? [],
    groupIds: policy?.groupIds ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const result = await savePolicyAction(
        slug,
        {
          name,
          unit,
          accrual,
          allowance: accrual === "NONE" ? "" : allowance,
          allowNegative,
          requiresApproval,
          ...assignees,
        },
        policy?.id,
      );
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success(policy ? "Policy saved" : "Policy added");
      await qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });
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
            <DialogTitle>{policy ? "Edit policy" : "New policy"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="policy-name">Name</Label>
            <Input
              id="policy-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name ? <p className="text-destructive text-sm">{errors.name[0]}</p> : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Counted in</legend>
            <RadioGroup
              value={unit}
              onValueChange={(v) => setUnit(v as TimeOffUnit)}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="DAYS" aria-label="Days" /> Days
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="HOURS" aria-label="Hours" /> Hours
              </label>
            </RadioGroup>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Allowance</legend>
            <RadioGroup
              value={accrual}
              onValueChange={(v) => setAccrual(v as TimeOffAccrual)}
              className="flex flex-wrap gap-4"
            >
              {ACCRUALS.map((a) => (
                <label key={a.value} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={a.value} aria-label={a.label} /> {a.label}
                </label>
              ))}
            </RadioGroup>
            {accrual === "NONE" ? (
              <p className="text-muted-foreground text-xs">
                Nothing is granted; balances change only by adjustments.
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="policy-allowance" className="sr-only">
                  Allowance
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="policy-allowance"
                    aria-label="Allowance"
                    inputMode="decimal"
                    className="w-28"
                    value={allowance}
                    onChange={(e) => setAllowance(e.target.value)}
                  />
                  <span className="text-muted-foreground text-sm">
                    {unit === "DAYS" ? "days" : "hours"} a year
                    {accrual === "MONTHLY" ? ", granted monthly" : ""}
                  </span>
                </div>
                {errors.allowance ? (
                  <p className="text-destructive text-sm">{errors.allowance[0]}</p>
                ) : null}
              </div>
            )}
          </fieldset>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Requires approval</span>
            <Switch
              aria-label="Requires approval"
              checked={requiresApproval}
              onCheckedChange={setRequiresApproval}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Allow negative balance
              {accrual === "NONE" ? (
                <span className="text-muted-foreground block text-xs">Unlimited time off.</span>
              ) : null}
            </span>
            <Switch
              aria-label="Allow negative balance"
              checked={allowNegative}
              onCheckedChange={setAllowNegative}
            />
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
            <Button type="submit" disabled={busy || !name.trim()}>
              Save policy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
