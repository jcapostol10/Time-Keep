"use client";

import { formatCenti, formatTimeOffDates, type TimeOffStatus } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import { Skeleton } from "@timekeep/ui/components/skeleton";
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
import type { TimeOffRequestDTO, TimeOffTab } from "@/lib/time-off-types";
import {
  cancelTimeOffAction,
  reviewTimeOffAction,
  withdrawTimeOffAction,
} from "@/server/actions/time-off";

import { RejectDialog } from "../approvals/reject-dialog";
import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";

const STATUS: Record<
  TimeOffStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  PENDING: { label: "Pending", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "default" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
};

function useRequests(slug: string, tab: TimeOffTab, enabled = true) {
  return useQuery({
    queryKey: timeOffKeys.requests(slug, tab),
    queryFn: () =>
      fetchJson<{ rows: TimeOffRequestDTO[] }>(timeOffUrls.requests(slug, tab)).then((r) => r.rows),
    enabled,
  });
}

const dates = (r: TimeOffRequestDTO) =>
  `${formatTimeOffDates(r.start, r.end)}${r.halfDay ? " (half day)" : ""}`;

function Status({ r }: { r: TimeOffRequestDTO }) {
  const s = STATUS[r.status];
  return (
    <span className="flex flex-col gap-0.5">
      <Badge variant={s.variant} className="w-fit">
        {s.label}
      </Badge>
      {r.decidedByName && r.status !== "PENDING" ? (
        <span className="text-muted-foreground text-xs">by {r.decidedByName}</span>
      ) : null}
      {r.decisionNote ? <span className="text-xs">“{r.decisionNote}”</span> : null}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground py-4 text-sm">{children}</p>;
}

/** The Requests tab: what the viewer reviews, their own time off, and the decided requests. */
export function RequestsTab({ slug, reviewer }: { slug: string; reviewer: boolean }) {
  const qc = useQueryClient();
  const review = useRequests(slug, "review", reviewer);
  const mine = useRequests(slug, "mine");
  const decided = useRequests(slug, "archive", reviewer);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState<TimeOffRequestDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const toReview = review.data ?? [];
  const chosen = toReview.filter((r) => selected.has(r.id)).map((r) => r.id);

  const refresh = () => qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });

  async function decide(decision: "APPROVE" | "REJECT", note?: string) {
    setBusy(true);
    try {
      const result = await reviewTimeOffAction(slug, { ids: chosen, decision, note });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      const n = result.data.length;
      const word = decision === "APPROVE" ? "approved" : "rejected";
      toast.success(n === 1 ? `Request ${word}` : `${n} requests ${word}`);
      setSelected(new Set());
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    const result = await withdrawTimeOffAction(slug, id);
    if (!result.ok) toast.error(result.error);
    else toast.success("Request withdrawn");
    await refresh();
  }

  return (
    <div className="space-y-8">
      {reviewer ? (
        <Section title="To review">
          {review.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : toReview.length === 0 ? (
            <Empty>Nothing waiting for review.</Empty>
          ) : (
            <div className="space-y-3">
              {chosen.length > 0 ? (
                <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                  <span className="text-sm">{chosen.length} selected</span>
                  <Button size="sm" disabled={busy} onClick={() => void decide("APPROVE")}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                  >
                    Reject…
                  </Button>
                </div>
              ) : null}
              <div className="rounded-md border">
                <Table aria-label="To review">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Select all"
                          checked={toReview.length > 0 && chosen.length === toReview.length}
                          onCheckedChange={(on) =>
                            setSelected(
                              on === true ? new Set(toReview.map((r) => r.id)) : new Set(),
                            )
                          }
                        />
                      </TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Policy</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {toReview.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${r.userName}, ${dates(r)}`}
                            checked={selected.has(r.id)}
                            onCheckedChange={(on) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (on === true) next.add(r.id);
                                else next.delete(r.id);
                                return next;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium">{r.userName}</TableCell>
                        <TableCell>{r.policyName}</TableCell>
                        <TableCell>{dates(r)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCenti(r.amountCenti, r.unit)}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-60 truncate">
                          {r.note}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </Section>
      ) : null}

      <Section title="My time off">
        {mine.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (mine.data ?? []).length === 0 ? (
          <Empty>You have not asked for time off yet.</Empty>
        ) : (
          <div className="rounded-md border">
            <Table aria-label="My time off">
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(mine.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.policyName}</TableCell>
                    <TableCell>{dates(r)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCenti(r.amountCenti, r.unit)}
                    </TableCell>
                    <TableCell>
                      <Status r={r} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "PENDING" ? (
                        <Button size="sm" variant="outline" onClick={() => void withdraw(r.id)}>
                          Withdraw
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {reviewer ? (
        <Section title="Decided">
          {decided.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (decided.data ?? []).length === 0 ? (
            <Empty>No decisions yet.</Empty>
          ) : (
            <div className="rounded-md border">
              <Table aria-label="Decided">
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(decided.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.userName}</TableCell>
                      <TableCell>{r.policyName}</TableCell>
                      <TableCell>{dates(r)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCenti(r.amountCenti, r.unit)}
                      </TableCell>
                      <TableCell>
                        <Status r={r} />
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "APPROVED" && r.canReview ? (
                          <Button size="sm" variant="outline" onClick={() => setCancelling(r)}>
                            Cancel time off…
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
      ) : null}

      {rejecting ? (
        <RejectDialog
          title="Reject time off"
          action="Reject"
          description="The person sees this note with the rejected request."
          onClose={() => setRejecting(false)}
          onSubmit={async (note) => {
            if (await decide("REJECT", note)) setRejecting(false);
          }}
        />
      ) : null}
      {cancelling ? (
        <RejectDialog
          title="Cancel time off"
          action="Cancel time off"
          description={`${cancelling.userName}'s ${cancelling.policyName}, ${dates(cancelling)}: the days go back to the balance and the person sees this note.`}
          onClose={() => setCancelling(null)}
          onSubmit={async (note) => {
            const result = await cancelTimeOffAction(slug, cancelling.id, { note });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Time off cancelled");
            setCancelling(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
