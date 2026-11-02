"use client";

import { Button } from "@timekeep/ui/components/button";
import Link from "next/link";
import { useState } from "react";

import { workspaceRoutes } from "@/lib/routes";

import type { Option } from "./assignees-field";
import { BalancesTab } from "./balances-tab";
import { HolidaysTab } from "./holidays-tab";
import { MonthCalendar } from "./month-calendar";
import { PoliciesTab } from "./policies-tab";
import { RequestDialog } from "./request-dialog";
import { RequestsTab } from "./requests-tab";

export type TimeOffPageTab = "requests" | "calendar" | "balances" | "policies" | "holidays";

const LABELS: Record<TimeOffPageTab, string> = {
  requests: "Requests",
  calendar: "Calendar",
  balances: "Balances",
  policies: "Policies",
  holidays: "Holidays",
};

/** The Time off page: tabs in the URL, "Request time off" on every tab. */
export function TimeOffPageClient({
  slug,
  tab,
  tabs,
  year,
  manages,
  reviewer,
  seesTeam,
  people,
  groups,
}: {
  slug: string;
  tab: TimeOffPageTab;
  tabs: readonly TimeOffPageTab[];
  year: number;
  manages: boolean;
  reviewer: boolean;
  seesTeam: boolean;
  people: Option[];
  groups: Option[];
}) {
  const [requesting, setRequesting] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav role="tablist" aria-label="Time off" className="flex flex-wrap gap-1 border-b">
          {tabs.map((t) => (
            <Link
              key={t}
              role="tab"
              aria-selected={t === tab}
              href={workspaceRoutes.timeOff(slug, t)}
              className={
                t === tab
                  ? "border-primary -mb-px border-b-2 px-3 py-2 text-sm font-medium"
                  : "text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
              }
            >
              {LABELS[t]}
            </Link>
          ))}
        </nav>
        <Button onClick={() => setRequesting(true)}>Request time off</Button>
      </div>
      {tab === "requests" ? <RequestsTab slug={slug} reviewer={reviewer} /> : null}
      {tab === "calendar" ? <MonthCalendar slug={slug} /> : null}
      {tab === "balances" ? (
        <BalancesTab slug={slug} manages={manages} seesTeam={seesTeam} />
      ) : null}
      {tab === "policies" ? <PoliciesTab slug={slug} people={people} groups={groups} /> : null}
      {tab === "holidays" ? (
        <HolidaysTab slug={slug} year={year} people={people} groups={groups} />
      ) : null}
      {requesting ? <RequestDialog slug={slug} onClose={() => setRequesting(false)} /> : null}
    </div>
  );
}
