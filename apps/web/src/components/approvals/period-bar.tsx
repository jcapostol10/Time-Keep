"use client";

import { formatDuration, formatPeriod } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { MyPeriodDTO } from "@/lib/approval-types";
import { fetchJson } from "@/lib/fetch-json";
import { submitPeriodAction, withdrawRequestAction } from "@/server/actions/approvals";

import { trackerKeys, trackerUrls } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";

const STATUS: Record<NonNullable<MyPeriodDTO["status"]> | "NONE", string> = {
  NONE: "Not submitted",
  PENDING: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const BADGE: Record<
  NonNullable<MyPeriodDTO["status"]> | "NONE",
  "outline" | "secondary" | "default" | "destructive"
> = {
  NONE: "outline",
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};

/**
 * The viewer's own approval periods overlapping `[from, to)` (Phase 5a), each
 * with its status and Submit / Withdraw / Resubmit. Periods are the
 * workspace's, so one may start mid-way through the week shown; each names
 * its dates. Nothing shows while the workspace does not use approvals.
 */
export function PeriodBar({ from, to }: { from: string; to: string }) {
  const { slug, viewer } = useTracker();
  const { data } = useQuery({
    queryKey: trackerKeys.periods(slug, from, to),
    queryFn: () => fetchJson<{ periods: MyPeriodDTO[] }>(trackerUrls.periods(slug, from, to)),
  });
  const periods = data?.periods ?? [];
  if (periods.length === 0) return null;
  return (
    <div aria-label="Approval" role="region" className="flex flex-col gap-2">
      {periods.map((p) => (
        <PeriodRow key={p.period.start} period={p} durationFormat={viewer.durationFormat} />
      ))}
    </div>
  );
}

function PeriodRow({
  period: p,
  durationFormat,
}: {
  period: MyPeriodDTO;
  durationFormat: Parameters<typeof formatDuration>[1];
}) {
  const { slug, notifyEntriesChanged } = useTracker();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = p.status ?? "NONE";
  const name = formatPeriod(p.period);

  async function run(
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
  ) {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      // Submitted time turns read-only (and back): every entry view refetches.
      await qc.invalidateQueries({ queryKey: trackerKeys.allEntries(slug) });
      notifyEntriesChanged();
    } finally {
      setBusy(false);
    }
  }

  const submit = () =>
    run(() => submitPeriodAction(slug, { periodStart: p.period.start }), "Submitted for approval");

  return (
    <div
      role="group"
      aria-label={`Period ${name}`}
      className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm"
    >
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground tabular-nums">
        {formatDuration(p.workSeconds, durationFormat)}
      </span>
      <Badge variant={BADGE[status]}>{STATUS[status]}</Badge>
      {status === "REJECTED" && p.note ? (
        <span className="text-muted-foreground basis-full sm:basis-auto">“{p.note}”</span>
      ) : null}
      <div className="ml-auto flex gap-2">
        {status === "PENDING" && p.requestId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => withdrawRequestAction(slug, p.requestId!), "Withdrawn")}
          >
            Withdraw
          </Button>
        ) : null}
        {p.canSubmit ? (
          <Button size="sm" disabled={busy} onClick={submit}>
            {status === "REJECTED" ? "Resubmit" : "Submit for approval"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
