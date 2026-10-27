"use client";

import { formatDuration, formatMoney, formatTimeOfDay } from "@timekeep/core";
import { Card, CardContent, CardHeader, CardTitle } from "@timekeep/ui/components/card";
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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchJson } from "@/lib/fetch-json";
import { detailedHref } from "@/lib/report-links";
import type { DashboardMe, TeamMember } from "@/server/dashboard";

import { DatePresetMenu } from "../reports/date-preset-menu";
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Total time</CardTitle>
          </CardHeader>
          <CardContent
            className="text-2xl font-semibold tabular-nums"
            data-testid="dashboard-total"
          >
            {fmt(data.totals.durationSeconds)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Billable</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {billableShare}%
          </CardContent>
        </Card>
        {data.money ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">Amount</CardTitle>
            </CardHeader>
            <CardContent
              className="text-2xl font-semibold tabular-nums"
              data-testid="dashboard-amount"
            >
              {formatMoney(data.totals.amountMinor, data.money.currency)}
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Top project</CardTitle>
          </CardHeader>
          <CardContent data-testid="dashboard-top-project">
            <p className="truncate text-lg font-semibold">{data.topProject?.label ?? "—"}</p>
            {data.topProject ? (
              <p className="text-muted-foreground text-sm tabular-nums">
                {fmt(data.topProject.seconds)}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Top client</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="truncate text-lg font-semibold">{data.topClient?.label ?? "—"}</p>
            {data.topClient ? (
              <p className="text-muted-foreground text-sm tabular-nums">
                {fmt(data.topClient.seconds)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="bg-card h-64 rounded-lg border p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                tickFormatter={(s: number) => `${Math.round(s / 360) / 10}h`}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Most tracked</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
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
                  {m.running ? (
                    <span className="text-primary flex items-center gap-1 text-xs font-medium">
                      <span className="bg-primary size-2 animate-pulse rounded-full" aria-hidden />
                      Tracking now
                    </span>
                  ) : null}
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
                  {formatMoney(m.amountMinor, currency)}
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
