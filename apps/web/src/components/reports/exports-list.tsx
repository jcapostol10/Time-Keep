"use client";

import { formatDateInZone, formatTimeOfDay } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { fetchJson } from "@/lib/fetch-json";
import { exportDownloadAction, retryExportAction } from "@/server/actions/exports";
import type { ExportJobDTO } from "@/server/export-jobs";

import { trackerKeys } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";

const REPORT_LABELS: Record<string, string> = {
  summary: "Summary",
  detailed: "Detailed",
  weekly: "Weekly",
  "project-status": "Project status",
};
const FORMAT_LABELS: Record<string, string> = { csv: "CSV", xlsx: "Excel", pdf: "PDF" };

function statusOf(job: ExportJobDTO): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (job.status === "done")
    return job.downloadable
      ? { label: "Ready", variant: "default" }
      : { label: "Expired", variant: "outline" };
  if (job.status === "failed") return { label: "Failed", variant: "destructive" };
  return { label: "Preparing…", variant: "secondary" };
}

/** The viewer's export jobs; polls while one is still being prepared. */
export function ExportsList() {
  const { slug, viewer } = useTracker();
  const queryClient = useQueryClient();
  const key = [...trackerKeys.reportOptions(slug), "exports"];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => fetchJson<{ jobs: ExportJobDTO[] }>(`/api/w/${slug}/reports/exports`),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((j) => j.status === "queued" || j.status === "running")
        ? 2000
        : false,
  });

  async function download(job: ExportJobDTO) {
    const result = await exportDownloadAction(slug, job.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    window.location.assign(result.data.url);
  }

  async function retry(job: ExportJobDTO) {
    const result = await retryExportAction(slug, job.id);
    if (!result.ok) toast.error(result.error);
    await queryClient.invalidateQueries({ queryKey: key });
  }

  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No exports yet. Exports with many rows are prepared here and kept for seven days.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Export</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Rows</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const status = statusOf(job);
            const label = `${REPORT_LABELS[job.report] ?? job.report} · ${FORMAT_LABELS[job.format] ?? job.format}`;
            const created = new Date(job.createdAt);
            return (
              <TableRow key={job.id} aria-label={`${label} ${status.label}`}>
                <TableCell className="font-medium">{label}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDateInZone(created, viewer.timezone, viewer.dateFormat)}{" "}
                  {formatTimeOfDay(created, viewer.timezone, viewer.timeFormat)}
                </TableCell>
                <TableCell>{job.rowCount !== null ? `${job.rowCount} rows` : "—"}</TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {job.error ? (
                    <span className="text-muted-foreground ml-2 text-xs">{job.error}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {job.downloadable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void download(job)}
                    >
                      <DownloadIcon /> Download
                    </Button>
                  ) : job.status === "failed" ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => void retry(job)}>
                      <RotateCcwIcon /> Retry
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
