"use client";

import type { ReportKind } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { DownloadIcon } from "lucide-react";

import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";

const FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel" },
] as const;

/** Downloads the current report, with its filters, as a file. */
export function ExportMenu({ kind }: { kind: ReportKind }) {
  const { slug } = useTracker();
  const { params } = useReportQuery();

  function href(format: string) {
    const search = new URLSearchParams(params);
    search.set("report", kind);
    search.set("format", format);
    return `/api/w/${slug}/reports/export?${search.toString()}`;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <DownloadIcon /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.format} asChild>
            <a href={href(f.format)} download>
              {f.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
