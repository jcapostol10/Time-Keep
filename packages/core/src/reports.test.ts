import { describe, expect, it } from "vitest";

import {
  bucketFor,
  bucketKeys,
  buildWeekly,
  type GroupKey,
  groupRows,
  parseReportQuery,
  type ReportRow,
  type ReportTotals,
  reportQuerySchema,
  reportQueryToSearchParams,
  resolveReportRange,
} from "./reports";
import type { ViewerPrefs } from "./prefs";
import { canReadTeam } from "./roles";

const MANILA = { timezone: "Asia/Manila", weekStart: 1 as const };
const NY_SUNDAY = { timezone: "America/New_York", weekStart: 0 as const };
/** Wed 2026-03-11 12:00 Manila. */
const NOW = new Date("2026-03-11T04:00:00.000Z");

const iso = (from: Date, to: Date) => [from.toISOString(), to.toISOString()];

describe("report query", () => {
  it("parses defaults from an empty URL and round-trips through search params", () => {
    const q = parseReportQuery(new URLSearchParams());
    expect(q).toMatchObject({
      preset: "this-week",
      groupBy: ["project"],
      tagMode: "or",
      billable: "all",
      description: "",
      userIds: [],
      projectIds: [],
    });
    const params = new URLSearchParams(
      "preset=last-month&projectIds=p1&projectIds=none&tagIds=t1&tagMode=and&billable=yes&groupBy=client&groupBy=project&description=site",
    );
    const parsed = parseReportQuery(params);
    expect(parsed).toMatchObject({
      preset: "last-month",
      projectIds: ["p1", "none"],
      tagIds: ["t1"],
      tagMode: "and",
      billable: "yes",
      groupBy: ["client", "project"],
      description: "site",
    });
    expect(parseReportQuery(reportQueryToSearchParams(parsed))).toEqual(parsed);
    // Defaults are not written back.
    expect(reportQueryToSearchParams(parseReportQuery(new URLSearchParams())).toString()).toBe("");
  });

  it("rejects a fourth or repeated group key and a custom range without dates, and falls back to defaults", () => {
    const base = { groupBy: ["client", "project", "user", "task"] };
    expect(reportQuerySchema.safeParse(base).success).toBe(false);
    expect(reportQuerySchema.safeParse({ groupBy: ["project", "project"] }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ preset: "custom" }).success).toBe(false);
    expect(
      reportQuerySchema.safeParse({
        preset: "custom",
        from: "2026-03-02T00:00:00.000Z",
        to: "2026-03-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(parseReportQuery(new URLSearchParams("groupBy=nonsense&preset=never")).preset).toBe(
      "this-week",
    );
  });
});

describe("resolveReportRange", () => {
  const at = (
    preset: string,
    prefs: Pick<ViewerPrefs, "timezone" | "weekStart"> = MANILA,
    now = NOW,
  ) => resolveReportRange(parseReportQuery(new URLSearchParams(`preset=${preset}`)), prefs, now);

  it("resolves every preset in the viewer's zone with Monday weeks", () => {
    expect(iso(at("today").from, at("today").to)).toEqual([
      "2026-03-10T16:00:00.000Z",
      "2026-03-11T16:00:00.000Z",
    ]);
    expect(iso(at("yesterday").from, at("yesterday").to)).toEqual([
      "2026-03-09T16:00:00.000Z",
      "2026-03-10T16:00:00.000Z",
    ]);
    expect(iso(at("this-week").from, at("this-week").to)).toEqual([
      "2026-03-08T16:00:00.000Z",
      "2026-03-15T16:00:00.000Z",
    ]);
    expect(iso(at("last-week").from, at("last-week").to)).toEqual([
      "2026-03-01T16:00:00.000Z",
      "2026-03-08T16:00:00.000Z",
    ]);
    expect(iso(at("this-month").from, at("this-month").to)).toEqual([
      "2026-02-28T16:00:00.000Z",
      "2026-03-31T16:00:00.000Z",
    ]);
    expect(iso(at("last-month").from, at("last-month").to)).toEqual([
      "2026-01-31T16:00:00.000Z",
      "2026-02-28T16:00:00.000Z",
    ]);
    expect(iso(at("this-year").from, at("this-year").to)).toEqual([
      "2025-12-31T16:00:00.000Z",
      "2026-12-31T16:00:00.000Z",
    ]);
    expect(iso(at("last-year").from, at("last-year").to)).toEqual([
      "2024-12-31T16:00:00.000Z",
      "2025-12-31T16:00:00.000Z",
    ]);
    expect(at("this-week").label).toBe("This week");
    expect(at("last-year").label).toBe("Last year");
  });

  it("keeps a week whole across the New York spring-forward change, with Sunday weeks", () => {
    const r = at("this-week", NY_SUNDAY, new Date("2026-03-10T15:00:00.000Z"));
    expect(iso(r.from, r.to)).toEqual(["2026-03-08T05:00:00.000Z", "2026-03-15T04:00:00.000Z"]);
  });

  it("crosses the year boundary for last month and last year", () => {
    const r = at("last-month", MANILA, new Date("2026-01-05T04:00:00.000Z"));
    expect(iso(r.from, r.to)).toEqual(["2025-11-30T16:00:00.000Z", "2025-12-31T16:00:00.000Z"]);
  });

  it("returns a custom range as given, labelled by its dates", () => {
    const q = parseReportQuery(
      new URLSearchParams(
        "preset=custom&from=2026-03-01T16:00:00.000Z&to=2026-03-15T16:00:00.000Z",
      ),
    );
    const r = resolveReportRange(q, MANILA, NOW);
    expect(iso(r.from, r.to)).toEqual(["2026-03-01T16:00:00.000Z", "2026-03-15T16:00:00.000Z"]);
    expect(r.label).toContain("Mar 2");
    expect(r.label).toContain("Mar 15");
  });
});

describe("bucketFor", () => {
  const days = (n: number) =>
    bucketFor(new Date("2026-03-01T16:00:00.000Z"), new Date(2026, 2, 2 + n - 1, 0, 0, 0), "UTC");
  it("picks days up to a month, weeks up to a year, months beyond; an override wins", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const plus = (n: number) => new Date(from.getTime() + n * 86_400_000);
    expect(bucketFor(from, plus(7), "UTC")).toBe("day");
    expect(bucketFor(from, plus(31), "UTC")).toBe("day");
    expect(bucketFor(from, plus(32), "UTC")).toBe("week");
    expect(bucketFor(from, plus(366), "UTC")).toBe("week");
    expect(bucketFor(from, plus(367), "UTC")).toBe("month");
    expect(bucketFor(from, plus(7), "UTC", "month")).toBe("month");
    void days;
  });
});

const t = (durationSeconds: number, billableSeconds: number, entryCount: number): ReportTotals => ({
  durationSeconds,
  billableSeconds,
  entryCount,
});
const row = (
  keys: Partial<Record<GroupKey, { id: string | null; label: string }>>,
  totals: ReportTotals,
): ReportRow => ({ keys, totals });
const KEYS: GroupKey[] = ["client", "project", "user"];
const FIXTURE: ReportRow[] = [
  row(
    {
      client: { id: "acme", label: "Acme" },
      project: { id: "web", label: "Web" },
      user: { id: "a", label: "Alice" },
    },
    t(3600, 3600, 2),
  ),
  row(
    {
      client: { id: "acme", label: "Acme" },
      project: { id: "web", label: "Web" },
      user: { id: "b", label: "Bob" },
    },
    t(1800, 0, 1),
  ),
  row(
    {
      client: { id: "acme", label: "Acme" },
      project: { id: "app", label: "App" },
      user: { id: "a", label: "Alice" },
    },
    t(7200, 7200, 3),
  ),
  row(
    {
      client: { id: "globex", label: "Globex" },
      project: { id: "site", label: "Site" },
      user: { id: "b", label: "Bob" },
    },
    t(600, 600, 1),
  ),
  row(
    {
      client: { id: null, label: "No client" },
      project: { id: "internal", label: "Internal" },
      user: { id: "a", label: "Alice" },
    },
    t(900, 0, 1),
  ),
  row(
    {
      client: { id: null, label: "No client" },
      project: { id: null, label: "No project" },
      user: { id: "b", label: "Bob" },
    },
    t(300, 0, 1),
  ),
];

describe("groupRows", () => {
  it("nests three levels with totals at each level, sorted by duration", () => {
    const overall = t(14400, 11400, 9);
    const { groups, totals } = groupRows(FIXTURE, KEYS, overall);
    expect(totals).toEqual(overall);
    expect(groups.map((g) => [g.label, g.totals.durationSeconds])).toEqual([
      ["Acme", 12600],
      ["No client", 1200],
      ["Globex", 600],
    ]);
    const acme = groups[0]!;
    expect(acme.key).toBe("client");
    expect(acme.totals).toEqual(t(12600, 10800, 6));
    expect(acme.children.map((g) => [g.key, g.label, g.totals.durationSeconds])).toEqual([
      ["project", "App", 7200],
      ["project", "Web", 5400],
    ]);
    const web = acme.children[1]!;
    expect(
      web.children.map((g) => [g.key, g.label, g.totals.durationSeconds, g.totals.entryCount]),
    ).toEqual([
      ["user", "Alice", 3600, 2],
      ["user", "Bob", 1800, 1],
    ]);
    expect(web.children[0]!.children).toEqual([]);
    expect(groups[1]!.children.map((g) => [g.id, g.label])).toEqual([
      ["internal", "Internal"],
      [null, "No project"],
    ]);
  });

  it("keeps the caller's overall total when tag groups overlap", () => {
    const tagged: ReportRow[] = [
      row({ tag: { id: "urgent", label: "urgent" } }, t(100, 100, 1)),
      row({ tag: { id: "review", label: "review" } }, t(100, 100, 1)),
    ];
    const { groups, totals } = groupRows(tagged, ["tag"], t(100, 100, 1));
    expect(groups.reduce((n, g) => n + g.totals.durationSeconds, 0)).toBe(200);
    expect(totals.durationSeconds).toBe(100);
  });
});

describe("buildWeekly", () => {
  it("lays rows over the week's days with day, row and grand totals", () => {
    const days = [
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ];
    const { rows, dayTotals, total } = buildWeekly(
      [
        { id: "web", label: "Web", dateKey: "2026-03-09", seconds: 3600 },
        { id: "web", label: "Web", dateKey: "2026-03-10", seconds: 1800 },
        { id: "app", label: "App", dateKey: "2026-03-11", seconds: 7200 },
        { id: "app", label: "App", dateKey: "2026-03-20", seconds: 999 },
      ],
      days,
    );
    expect(rows).toEqual([
      { id: "app", label: "App", days: [0, 0, 7200, 0, 0, 0, 0], total: 7200 },
      { id: "web", label: "Web", days: [3600, 1800, 0, 0, 0, 0, 0], total: 5400 },
    ]);
    expect(dayTotals).toEqual([3600, 1800, 7200, 0, 0, 0, 0]);
    expect(total).toBe(12600);
  });
});

describe("canReadTeam", () => {
  it("is true for owners, admins and managers only", () => {
    expect(canReadTeam("owner")).toBe(true);
    expect(canReadTeam("admin")).toBe(true);
    expect(canReadTeam("manager")).toBe(true);
    expect(canReadTeam("member")).toBe(false);
  });
});

describe("bucketKeys", () => {
  it("lists every bucket of the range, empty ones included, with labels", () => {
    const days = bucketKeys(
      new Date("2026-03-01T16:00:00.000Z"),
      new Date("2026-03-15T16:00:00.000Z"),
      "day",
      MANILA,
    );
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ key: "2026-03-02", label: "Mar 2" });
    expect(days[13]).toEqual({ key: "2026-03-15", label: "Mar 15" });
    const weeks = bucketKeys(
      new Date("2026-03-01T16:00:00.000Z"),
      new Date("2026-04-05T16:00:00.000Z"),
      "week",
      MANILA,
    );
    expect(weeks.map((w) => w.key)).toEqual([
      "2026-03-02",
      "2026-03-09",
      "2026-03-16",
      "2026-03-23",
      "2026-03-30",
    ]);
    const months = bucketKeys(
      new Date("2025-12-31T16:00:00.000Z"),
      new Date("2026-03-31T16:00:00.000Z"),
      "month",
      MANILA,
    );
    expect(months).toEqual([
      { key: "2026-01", label: "Jan 2026" },
      { key: "2026-02", label: "Feb 2026" },
      { key: "2026-03", label: "Mar 2026" },
    ]);
  });
});
