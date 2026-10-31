"use client";

import { formatDuration, formatPeriod } from "@timekeep/core";
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
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import type { ApprovalRequestDTO, ApprovalsTab, UnsubmittedPeriodDTO } from "@/lib/approval-types";
import { fetchJson } from "@/lib/fetch-json";
import { workspaceRoutes } from "@/lib/routes";
import { reviewRequestsAction } from "@/server/actions/approvals";

import { trackerKeys } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";
import { RejectDialog } from "./reject-dialog";

const TAB_LABELS: Record<ApprovalsTab, string> = {
  pending: "Pending",
  unsubmitted: "Unsubmitted",
  archive: "Archive",
  mine: "Mine",
};

const STATUS_LABELS = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" } as const;

type Rows = ApprovalRequestDTO[] | UnsubmittedPeriodDTO[];

/** The Approvals page: tabs in the URL, a table per tab, bulk approve and reject on Pending. */
export function ApprovalsPageClient({
  slug,
  tab,
  reviewer,
}: {
  slug: string;
  tab: ApprovalsTab;
  /** Whether the viewer reviews anyone's periods; otherwise only Mine shows. */
  reviewer: boolean;
}) {
  const { data, isPending } = useQuery({
    queryKey: trackerKeys.approvals(slug, tab),
    queryFn: () =>
      fetchJson<{ tab: ApprovalsTab; rows: Rows }>(`/api/w/${slug}/approvals?tab=${tab}`),
  });
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <nav role="tablist" aria-label="Approvals" className="flex gap-1 border-b">
        {(reviewer ? (Object.keys(TAB_LABELS) as ApprovalsTab[]) : (["mine"] as const)).map((t) => (
          <Link
            key={t}
            role="tab"
            aria-selected={t === tab}
            href={workspaceRoutes.approvals(slug, t)}
            className={
              t === tab
                ? "border-primary -mb-px border-b-2 px-3 py-2 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
            }
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : tab === "unsubmitted" ? (
        <UnsubmittedTable rows={rows as UnsubmittedPeriodDTO[]} />
      ) : (
        <RequestsTable slug={slug} tab={tab} rows={rows as ApprovalRequestDTO[]} />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground py-8 text-center text-sm">{children}</p>;
}

function RequestsTable({
  slug,
  tab,
  rows,
}: {
  slug: string;
  tab: "pending" | "archive" | "mine";
  rows: ApprovalRequestDTO[];
}) {
  const { viewer } = useTracker();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = tab === "pending";
  // Ids no longer listed (decided elsewhere) drop out of the selection.
  const chosen = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const all = rows.length > 0 && chosen.length === rows.length;

  async function decide(decision: "APPROVE" | "REJECT", note?: string) {
    setBusy(true);
    try {
      const result = await reviewRequestsAction(slug, { ids: chosen, decision, note });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      const n = result.data.length;
      const word = decision === "APPROVE" ? "approved" : "rejected";
      toast.success(n === 1 ? `Period ${word}` : `${n} periods ${word}`);
      setSelected(new Set());
      // Decided time turns read-only (or editable again) wherever it shows.
      await qc.invalidateQueries({ queryKey: trackerKeys.allEntries(slug) });
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <Empty>
        {pending
          ? "Nothing waiting for approval."
          : tab === "mine"
            ? "You have not submitted any periods yet."
            : "No decisions yet."}
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {pending && chosen.length > 0 ? (
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          <span className="text-sm">{chosen.length} selected</span>
          <Button size="sm" disabled={busy} onClick={() => void decide("APPROVE")}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {pending ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={all}
                    onCheckedChange={(on) =>
                      setSelected(on === true ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                  />
                </TableHead>
              ) : null}
              <TableHead>Person</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead>{pending ? "Submitted" : "Status"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const period = formatPeriod({ start: r.periodStart, end: r.periodEnd });
              return (
                <TableRow key={r.id}>
                  {pending ? (
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${r.userName}, ${period}`}
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
                  ) : null}
                  <TableCell>
                    <Link
                      href={workspaceRoutes.approval(slug, r.id)}
                      className="font-medium hover:underline"
                    >
                      {r.userName}
                    </Link>
                  </TableCell>
                  <TableCell>{period}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(r.workSeconds, viewer.durationFormat)}
                  </TableCell>
                  <TableCell>
                    {pending ? (
                      new Date(r.submittedAt).toLocaleDateString()
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        <Badge
                          variant={
                            r.status === "APPROVED"
                              ? "default"
                              : r.status === "PENDING"
                                ? "secondary"
                                : "destructive"
                          }
                          className="w-fit"
                        >
                          {STATUS_LABELS[r.status]}
                        </Badge>
                        {r.decidedByName ? (
                          <span className="text-muted-foreground text-xs">
                            by {r.decidedByName}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {rejecting ? (
        <RejectDialog
          title={chosen.length === 1 ? "Reject 1 period" : `Reject ${chosen.length} periods`}
          action="Reject"
          onClose={() => setRejecting(false)}
          onSubmit={async (note) => {
            const done = await decide("REJECT", note);
            if (done) setRejecting(false);
          }}
        />
      ) : null}
    </div>
  );
}

function UnsubmittedTable({ rows }: { rows: UnsubmittedPeriodDTO[] }) {
  const { viewer } = useTracker();
  if (rows.length === 0) return <Empty>Every closed period with time is submitted.</Empty>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.userId}:${r.periodStart}`}>
              <TableCell className="font-medium">{r.userName}</TableCell>
              <TableCell>{formatPeriod({ start: r.periodStart, end: r.periodEnd })}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDuration(r.workSeconds, viewer.durationFormat)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
