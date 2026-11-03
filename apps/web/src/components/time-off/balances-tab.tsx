"use client";

import { formatCenti } from "@timekeep/core";
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
import { Skeleton } from "@timekeep/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { Textarea } from "@timekeep/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { fetchJson } from "@/lib/fetch-json";
import type { BalanceDTO } from "@/lib/time-off-types";
import { addAdjustmentAction } from "@/server/actions/time-off";

import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";

/** This year's balances of everyone the viewer may see; admins adjust them. */
export function BalancesTab({
  slug,
  manages,
  seesTeam,
}: {
  slug: string;
  manages: boolean;
  seesTeam: boolean;
}) {
  const { data, isPending } = useQuery({
    queryKey: timeOffKeys.balances(slug),
    queryFn: () =>
      fetchJson<{ balances: BalanceDTO[] }>(timeOffUrls.balances(slug)).then((r) => r.balances),
  });
  const [adjusting, setAdjusting] = useState<BalanceDTO | null>(null);
  if (isPending) return <Skeleton className="h-24 w-full" />;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-6 text-sm">No time off policies apply yet.</p>;
  }
  const fmt = (centi: number, b: BalanceDTO) => formatCenti(centi, b.unit);
  return (
    <div className="rounded-md border">
      <Table aria-label="Balances">
        <TableHeader>
          <TableRow>
            {seesTeam ? <TableHead>Person</TableHead> : null}
            <TableHead>Policy</TableHead>
            <TableHead className="text-right">Granted</TableHead>
            <TableHead className="text-right">Adjusted</TableHead>
            <TableHead className="text-right">Used</TableHead>
            <TableHead className="text-right">Pending</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            {manages ? <TableHead className="w-20" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => (
            <TableRow key={`${b.userId}-${b.policyId}`}>
              {seesTeam ? <TableCell className="font-medium">{b.userName}</TableCell> : null}
              <TableCell>{b.policyName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmt(b.balance.grantedCenti, b)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmt(b.balance.adjustmentsCenti, b)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmt(b.balance.usedCenti, b)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmt(b.balance.pendingCenti, b)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {b.balance.unlimited ? "Unlimited" : fmt(b.balance.balanceCenti, b)}
              </TableCell>
              {manages ? (
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setAdjusting(b)}>
                    Adjust
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {adjusting ? (
        <AdjustDialog slug={slug} balance={adjusting} onClose={() => setAdjusting(null)} />
      ) : null}
    </div>
  );
}

function AdjustDialog({
  slug,
  balance,
  onClose,
}: {
  slug: string;
  balance: BalanceDTO;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const unit = balance.unit === "DAYS" ? "days" : "hours";
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await addAdjustmentAction(slug, {
                policyId: balance.policyId,
                userId: balance.userId,
                amount,
                note,
              });
              if (!result.ok) {
                toast.error(result.fieldErrors?.amount?.[0] ?? result.error);
                return;
              }
              toast.success("Balance adjusted");
              await qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Adjust {balance.policyName} for {balance.userName}
            </DialogTitle>
            <DialogDescription>
              Add or take away {unit} this year: a negative amount takes them away.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="adjust-amount">Amount ({unit})</Label>
            <Input
              id="adjust-amount"
              inputMode="decimal"
              placeholder="2 or -1.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjust-note">Note</Label>
            <Textarea
              id="adjust-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !amount.trim() || note.trim().length < 3}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
