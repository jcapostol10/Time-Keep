"use client";

import { Alert, AlertDescription, AlertTitle } from "@timekeep/ui/components/alert";
import { Button } from "@timekeep/ui/components/button";
import { CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { retryRateRecalcAction } from "@/server/actions/rates";

import { useRateRecalc, watchRateRecalc } from "./use-rates";

const count = new Intl.NumberFormat("en-US");

/**
 * Progress of "apply to past entries": shown while a job waits or runs, when
 * it fails (with Retry), and once the job this page started has finished.
 */
export function RecalcBanner({ slug }: { slug: string }) {
  const { job, watchedId } = useRateRecalc(slug);
  const [pending, startTransition] = useTransition();
  if (!job) return null;

  if (job.status === "queued" || job.status === "running") {
    const of = job.total ? ` of ${count.format(job.total)}` : "";
    return (
      <Alert role="status" className="mb-4">
        <Loader2Icon className="animate-spin" />
        <AlertTitle>Updating entries with the new rate</AlertTitle>
        <AlertDescription>
          {job.status === "queued"
            ? "Starting…"
            : `Updating entries: ${count.format(job.processed)}${of}`}
        </AlertDescription>
      </Alert>
    );
  }
  if (job.status === "failed") {
    return (
      <Alert role="status" variant="destructive" className="mb-4">
        <TriangleAlertIcon />
        <AlertTitle>Entries were not all updated</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>
            {job.error ?? "The update stopped."} {count.format(job.processed)} updated so far.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await retryRateRecalcAction(slug, job.id);
                if (!result.ok) toast.error(result.error);
                else watchRateRecalc(job.id);
              })
            }
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (job.id !== watchedId) return null;
  return (
    <Alert role="status" className="mb-4">
      <CheckCircle2Icon />
      <AlertTitle>Entries updated</AlertTitle>
      <AlertDescription>
        {count.format(job.processed)} {job.processed === 1 ? "entry now uses" : "entries now use"}{" "}
        the new rate.
      </AlertDescription>
    </Alert>
  );
}
