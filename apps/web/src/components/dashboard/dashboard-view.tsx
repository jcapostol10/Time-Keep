"use client";

import { formatDuration, formatTimeOfDay } from "@timekeep/core";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@timekeep/ui/components/tabs";
import { cn } from "@timekeep/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchJson } from "@/lib/fetch-json";
import { LiveDot } from "@/components/dashboard/live-dot";
import { detailedHref } from "@/lib/report-links";
import type { DashboardMe, TeamMember } from "@/server/dashboard";

import { ProgressBar } from "../projects/progress-bar";
import { DatePresetMenu } from "../reports/date-preset-menu";
import { MoneyCell } from "../reports/money-cell";
import { useReportQuery } from "../reports/report-url";
import { trackerKeys } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";

const tooltipStyle = {
  background: "var(--popover)",
  borderColor: "var(--border)",
  color: "var(--popover-foreground)",
  borderRadius: 8,
  fontSize: 12,
};

const FIGURE = "font-display text-2xl font-semibold tabular-nums";

/** One figure of the summary strip: a quiet label above what it measures. */
function Stat({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("bg-card min-w-0 px-4 py-3", className)}>
      <dt className="text-muted-foreground text-meta mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function MeTab({ data }: { data: DashboardMe | undefined }) {
  const { slug, viewer } = useTracker();
  const fmt = (s: number) => formatDuration(s, viewer.durationFormat);
  if (!data) return <Skeleton className="h-64 w-full" />;
  const billableShare =
    data.totals.durationSeconds > 0
      ? Math.round((data.totals.billableSeconds / data.totals.durationSeconds) * 100)
      : 0;
  const bars = data.series.map((p) => ({
    label: p.label,
    seconds: p.billableSeconds + p.nonBillableSeconds,
  }));
  return (
    <div className="space-y-4">
      {/*
        One frame for the figures, with hairlines between them, as on a time
        card's summary row: not a tile each. The total leads.
      */}
      <div
        role="group"
        aria-label="Summary"
        className="bg-border overflow-hidden rounded-lg border"
      >
        <dl
          className={cn(
            "grid grid-cols-2 gap-px",
            data.money ? "lg:grid-cols-5" : "lg:grid-cols-4",
          )}
        >
          <Stat label="Total time" className={data.money ? "max-lg:col-span-2" : undefined}>
            <span
              className="font-display text-display font-semibold tabular-nums"
              data-testid="dashboard-total"
            >
              {fmt(data.totals.durationSeconds)}
            </span>
          </Stat>
          <Stat label="Billable">
            <span className={FIGURE}>{billableShare}%</span>
          </Stat>
          {data.money ? (
            <Stat label="Amount">
              <span className={FIGURE} data-testid="dashboard-amount">
                <MoneyCell amounts={data.totals} currency={data.money.currency} />
              </span>
            </Stat>
          ) : null}
          <Stat label="Top project">
            <div data-testid="dashboard-top-project">
              <p className="truncate text-base font-semibold">{data.topProject?.label ?? "—"}</p>
              {data.topProject ? (
                <p className="text-muted-foreground text-sm tabular-nums">
                  {fmt(data.topProject.seconds)}
                </p>
              ) : null}
              {data.topProject?.progress ? (
                <ProgressBar
                  progress={data.topProject.progress}
                  durationFormat={viewer.durationFormat}
                  className="mt-2"
                />
              ) : null}
            </div>
          </Stat>
          <Stat label="Top client">
            <p className="truncate text-base font-semibold">{data.topClient?.label ?? "—"}</p>
            {data.topClient ? (
              <p className="text-muted-foreground text-sm tabular-nums">
                {fmt(data.topClient.seconds)}
              </p>
            ) : null}
          </Stat>
        </dl>
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="bg-card h-64 rounded-lg border p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                tickFormatter={(s: number) => `${Math.round(s / 360) / 10}h`}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [fmt(Number(v ?? 0)), "Time"]}
              />
              <Bar dataKey="seconds" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <section className="bg-card rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium">Most tracked</h2>
          <div>
            {data.mostTracked.length === 0 ? (
              <p className="text-muted-foreground text-sm">No time in this range.</p>
            ) : (
              <ol aria-label="Most tracked" className="space-y-2">
                {data.mostTracked.map((m) => (
                  <li
                    key={`${m.description}|${m.projectName ?? ""}`}
                    className="flex items-baseline justify-between gap-2 text-sm"
                  >
                    <Link
                      href={detailedHref(slug, m.detailedParams)}
                      className="min-w-0 truncate hover:underline"
                    >
                      {m.description || "(no description)"}
                      {m.projectName ? (
                        <span className="text-muted-foreground"> · {m.projectName}</span>
                      ) : null}
                    </Link>
                    <span className="shrink-0 font-medium tabular-nums">{fmt(m.seconds)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TeamTab({ slug, params }: { slug: string; params: string }) {
  const { viewer, canSeeAmounts, currency: workspaceCurrency } = useTracker();
  const currency = canSeeAmounts ? workspaceCurrency : null;
  const fmt = (s: number) => formatDuration(s, viewer.durationFormat);
  const { data } = useQuery({
    queryKey: [...trackerKeys.report(slug, "dashboard-team", params)],
    queryFn: () =>
      fetchJson<{ members: TeamMember[] }>(
        `/api/w/${slug}/dashboard/team${params ? `?${params}` : ""}`,
      ),
    // Who is tracking right now: poll, and refetch when the tab comes back.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
  if (!data) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Latest activity</TableHead>
            <TableHead className="text-right">Total</TableHead>
            {currency ? <TableHead className="text-right">Amount</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.members.map((m) => (
            <TableRow key={m.userId} aria-label={m.name}>
              <TableCell className="whitespace-nowrap font-medium">
                <span className="flex items-center gap-2">
                  {m.name}
                  {m.running ? <LiveDot label="Tracking now" /> : null}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {m.latest ? (
                  <span>
                    {m.latest.description || "(no description)"}
                    {m.latest.projectName ? ` · ${m.latest.projectName}` : ""}
                    {" · "}
                    {formatTimeOfDay(new Date(m.latest.start), viewer.timezone, viewer.timeFormat)}
                  </span>
                ) : (
                  "No time yet"
                )}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {fmt(m.totalSeconds)}
              </TableCell>
              {currency ? (
                <TableCell className="text-right tabular-nums">
                  <MoneyCell amounts={m} currency={currency} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Me and, for team readers, Team; the range is the URL's, like a report's. */
export function DashboardView({ canSeeTeam }: { canSeeTeam: boolean }) {
  const { slug, viewer } = useTracker();
  const { query, params, set } = useReportQuery();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tab = canSeeTeam && searchParams.get("tab") === "team" ? "team" : "me";
  const { data: me } = useQuery({
    queryKey: [...trackerKeys.report(slug, "dashboard-me", params)],
    queryFn: () =>
      fetchJson<DashboardMe>(`/api/w/${slug}/dashboard/me${params ? `?${params}` : ""}`),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  function setTab(next: string) {
    const search = new URLSearchParams(searchParams.toString());
    if (next === "team") search.set("tab", "team");
    else search.delete("tab");
    const s = search.toString();
    window.history.replaceState(null, "", s ? `${pathname}?${s}` : pathname);
  }

  return (
    <div className="space-y-4">
      <DatePresetMenu query={query} prefs={viewer} onChange={set} />
      {canSeeTeam ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="me">Me</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>
          <TabsContent value="me" className="mt-4">
            <MeTab data={me} />
          </TabsContent>
          <TabsContent value="team" className="mt-4">
            <TeamTab slug={slug} params={params} />
          </TabsContent>
        </Tabs>
      ) : (
        <MeTab data={me} />
      )}
    </div>
  );
}
