"use client";

import {
  formatDateKey,
  formatDayHeading,
  formatDuration,
  formatMoney,
  formatPeriod,
  formatTimeOfDay,
  localDateKey,
} from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import type { ApprovalEventDTO, PeriodViewDTO } from "@/lib/approval-types";
import { reopenRequestAction, reviewRequestsAction } from "@/server/actions/approvals";

import { useTracker } from "../tracker/tracker-provider";
import { RejectDialog } from "./reject-dialog";

const STATUS = { PENDING: "Pending approval", APPROVED: "Approved", REJECTED: "Rejected" } as const;

const VERBS: Record<ApprovalEventDTO["action"], string> = {
  SUBMIT: "submitted the period",
  WITHDRAW: "withdrew the period",
  APPROVE: "approved the period",
  REJECT: "rejected the period",
  REOPEN: "reopened the period",
  ADMIN_EDIT: "changed an entry",
  AUTO_WITHDRAW: "withdrew the period when approvals were turned off",
};

/** What an event did: an ADMIN_EDIT names an entry or, from Phase 6c, an expense. */
function verbOf(e: ApprovalEventDTO): string {
  if (e.action === "ADMIN_EDIT" && e.expenseId) return "changed an expense";
  return VERBS[e.action];
}

/** A submitted period for its owner and reviewers: days, totals, history, and the decision. */
export function PeriodView({ slug, view }: { slug: string; view: PeriodViewDTO }) {
  const { viewer } = useTracker();
  const router = useRouter();
  const [dialog, setDialog] = useState<"reject" | "reopen" | null>(null);
  const [busy, setBusy] = useState(false);
  const { request } = view;
  const name = formatPeriod(view.period);
  const fmt = (s: number) => formatDuration(s, viewer.durationFormat);
  const changed = view.live.workSeconds !== view.totals.workSeconds;

  async function run(
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const result = await call();
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      toast.success(done);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={request.userName} description={name} />
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant={
            request.status === "APPROVED"
              ? "default"
              : request.status === "REJECTED"
                ? "destructive"
                : "secondary"
          }
        >
          {STATUS[request.status]}
        </Badge>
        <span className="text-sm">
          Submitted <strong className="tabular-nums">{fmt(view.totals.workSeconds)}</strong>
          {" · "}billable <span className="tabular-nums">{fmt(view.totals.billableSeconds)}</span>
          {" · "}
          {view.totals.entryCount} {view.totals.entryCount === 1 ? "entry" : "entries"}
          {view.totals.expenseCount > 0 ? (
            <>
              {" · "}
              {view.totals.expenseCount} {view.totals.expenseCount === 1 ? "expense" : "expenses"}
              {" · "}
              <span className="tabular-nums">
                {formatMoney(view.totals.expenseMinor, view.currency)}
              </span>
            </>
          ) : null}
        </span>
        {changed ? (
          <span className="text-muted-foreground text-sm">
            Now <span className="tabular-nums">{fmt(view.live.workSeconds)}</span> after changes
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          {view.canReview ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => reviewRequestsAction(slug, { ids: [request.id], decision: "APPROVE" }),
                    "Period approved",
                  )
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setDialog("reject")}
              >
                Reject
              </Button>
            </>
          ) : null}
          {view.canReopen ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog("reopen")}>
              Reopen
            </Button>
          ) : null}
        </div>
      </div>
      {request.status === "REJECTED" && request.note ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Note:</span> {request.note}
        </p>
      ) : null}

      <section aria-label="Entries" className="space-y-4">
        {view.days.length === 0 ? (
          <p className="text-muted-foreground text-sm">No time in this period.</p>
        ) : (
          view.days.map((day) => (
            <div key={day.dateKey} className="rounded-md border">
              <div className="bg-muted/40 flex justify-between px-3 py-2 text-sm font-medium">
                <span>{formatDayHeading(day.dateKey, "1970-01-01")}</span>
                <span className="tabular-nums">{fmt(day.workSeconds)}</span>
              </div>
              <ul className="divide-y">
                {day.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {e.description || "(no description)"}
                      {e.project ? (
                        <span className="text-muted-foreground"> · {e.project.name}</span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatTimeOfDay(new Date(e.start), view.timezone, viewer.timeFormat)}
                      {e.end
                        ? ` – ${formatTimeOfDay(new Date(e.end), view.timezone, viewer.timeFormat)}`
                        : ""}
                    </span>
                    <span className="w-20 text-right tabular-nums">
                      {fmt(e.durationSeconds ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {view.expenses.length > 0 ? (
        <section aria-label="Expenses" className="space-y-2">
          <h2 className="text-lg font-semibold">Expenses</h2>
          <ul className="divide-y rounded-md border">
            {view.expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 px-3 py-2 text-sm">
                <span className="text-muted-foreground tabular-nums">{formatDateKey(e.date)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.categoryName}
                  {e.description ? <> · {e.description}</> : null}
                  <span className="text-muted-foreground"> · {e.projectName}</span>
                </span>
                <span className="w-24 text-right tabular-nums">
                  {formatMoney(e.amountMinor, view.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="History" className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        <ol className="space-y-2 text-sm">
          {view.events.map((e) => (
            <li key={e.id}>
              <span className="text-muted-foreground">
                {localDateKey(new Date(e.createdAt), view.timezone)}
              </span>{" "}
              <strong>{e.actorName ?? "Someone"}</strong> {verbOf(e)}
              {e.note ? <>: “{e.note}”</> : null}
            </li>
          ))}
        </ol>
      </section>

      {dialog === "reject" ? (
        <RejectDialog
          title="Reject 1 period"
          action="Reject"
          onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            const done = await run(
              () => reviewRequestsAction(slug, { ids: [request.id], decision: "REJECT", note }),
              "Period rejected",
            );
            if (done) setDialog(null);
          }}
        />
      ) : null}
      {dialog === "reopen" ? (
        <RejectDialog
          title="Reopen this period"
          action="Reopen"
          description="The period goes back to its owner as rejected, with your note, so they can correct it."
          onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            const done = await run(
              () => reopenRequestAction(slug, request.id, { note }),
              "Period reopened",
            );
            if (done) setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
