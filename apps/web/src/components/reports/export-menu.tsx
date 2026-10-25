"use client";

import type { ReportKind } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { workspaceRoutes } from "@/lib/routes";

import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";

const FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel" },
] as const;

/** The file name from a Content-Disposition header. */
function filenameOf(header: string | null, fallback: string): string {
  return header?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

/** Saves a response body as a file, through a temporary link. */
async function save(res: Response, fallback: string) {
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameOf(res.headers.get("content-disposition"), fallback);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads the current report, with its filters; a large one becomes an export job. */
export function ExportMenu({ kind }: { kind: ReportKind }) {
  const { slug } = useTracker();
  const { params } = useReportQuery();
  const [busy, setBusy] = useState(false);

  async function exportAs(format: string) {
    const search = new URLSearchParams(params);
    search.set("report", kind);
    search.set("format", format);
    setBusy(true);
    try {
      const res = await fetch(`/api/w/${slug}/reports/export?${search.toString()}`);
      if (res.status === 202) {
        toast("This export is large", {
          description: "It is being prepared; we'll email you when it is ready.",
          action: (
            <Link href={`${workspaceRoutes.reports(slug)}/exports`} className="text-sm underline">
              Open exports
            </Link>
          ),
        });
        return;
      }
      if (!res.ok) {
        toast.error("The export failed. Try again.");
        return;
      }
      await save(res, `timekeep-${kind}.${format}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.format} onSelect={() => void exportAs(f.format)}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
