"use client";

import { AUDIT_CRITERIA, type AuditCriterion } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@timekeep/ui/components/popover";
import { SearchCheckIcon } from "lucide-react";
import { useId } from "react";

import { useReportQuery } from "./report-url";

const LABELS: Record<AuditCriterion, string> = {
  noProject: "Without project",
  noTask: "Without task (on projects with tasks)",
  short: "Shorter than",
  long: "Longer than",
};

/** The Audit tab's criteria (any one matches) and their thresholds, all in the URL. */
export function AuditFilter() {
  const { query, set } = useReportQuery();
  const id = useId();
  const chosen = new Set(query.audit);
  function toggle(criterion: AuditCriterion, on: boolean) {
    set({ audit: AUDIT_CRITERIA.filter((c) => (c === criterion ? on : chosen.has(c))) });
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Audit: ${chosen.size} criteria`}>
          <SearchCheckIcon />
          Audit: {chosen.size}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start">
        {AUDIT_CRITERIA.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${c}`}
              checked={chosen.has(c)}
              // One criterion stays chosen: an empty list would match every entry.
              disabled={chosen.has(c) && chosen.size === 1}
              onCheckedChange={(on) => toggle(c, on === true)}
            />
            <Label htmlFor={`${id}-${c}`} className="font-normal">
              {LABELS[c]}
            </Label>
            {c === "short" ? (
              <>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  aria-label="Shorter than (minutes)"
                  value={query.shortMinutes}
                  onChange={(e) =>
                    set(
                      { shortMinutes: Math.max(1, Number(e.target.value) || 1) },
                      { replace: true },
                    )
                  }
                  className="h-8 w-20"
                />
                <span className="text-muted-foreground text-xs">min</span>
              </>
            ) : null}
            {c === "long" ? (
              <>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  aria-label="Longer than (hours)"
                  value={query.longHours}
                  onChange={(e) =>
                    set({ longHours: Math.max(1, Number(e.target.value) || 1) }, { replace: true })
                  }
                  className="h-8 w-20"
                />
                <span className="text-muted-foreground text-xs">h</span>
              </>
            ) : null}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
