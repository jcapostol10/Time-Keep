import { describe, expect, it } from "vitest";

import type { ViewerPrefs } from "./prefs";
import { attendanceDays, attendanceWeeks, sumAttendanceWeeks } from "./attendance";
import {
  attendanceColumns,
  type DetailedEntry,
  detailedColumns,
  flattenAttendance,
  type ExportColumn,
  flattenGroups,
  otherCurrencies,
  profitColumns,
  summaryColumns,
  toCsv,
  weeklyColumns,
} from "./report-export";
import {
  EMPTY_TOTALS,
  type GroupKey,
  groupRows,
  type ReportRow,
  type ReportTotals,
} from "./reports";
import { formatDateInZone } from "./time";
import { DEFAULT_CAPACITY } from "./time-off";

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};

const t = (
  durationSeconds: number,
  billableSeconds: number,
  entryCount: number,
  amountMinor = 0,
): ReportTotals => ({
  ...EMPTY_TOTALS,
  durationSeconds,
  billableSeconds,
  entryCount,
  amountMinor,
});
const row = (
  keys: Partial<Record<GroupKey, { id: string | null; label: string }>>,
  totals: ReportTotals,
): ReportRow => ({ keys, totals });
const FIXTURE: ReportRow[] = [
  row(
    { client: { id: "acme", label: "Acme" }, project: { id: "web", label: "Web" } },
    t(5400, 3600, 3),
  ),
  row(
    { client: { id: "acme", label: "Acme" }, project: { id: "app", label: "App" } },
    t(7200, 7200, 3),
  ),
  row(
    { client: { id: "globex", label: "Globex" }, project: { id: "site", label: "Site" } },
    t(600, 600, 1),
  ),
  row(
    { client: { id: null, label: "No client" }, project: { id: "internal", label: "Internal" } },
    t(900, 0, 1),
  ),
  row(
    { client: { id: null, label: "No client" }, project: { id: null, label: "No project" } },
    t(300, 0, 1),
  ),
];

describe("toCsv", () => {
  it("quotes fields with commas, quotes and newlines, prefixes a BOM and ends lines with CRLF", () => {
    type R = { a: string; n: number | null };
    const columns: ExportColumn<R>[] = [
      { key: "a", header: "Name", value: (r) => r.a },
      { key: "n", header: "N", value: (r) => r.n },
    ];
    const csv = toCsv(
      [
        { a: 'Say "hi", now\nplease', n: 3 },
        { a: "plain", n: null },
      ],
      columns,
    );
    expect(csv).toBe('﻿Name,N\r\n"Say ""hi"", now\nplease",3\r\nplain,\r\n');
  });
});

describe("summary export", () => {
  it("flattens nested groups into one row per leaf with every level's label", () => {
    const keys: GroupKey[] = ["client", "project"];
    const { groups } = groupRows(FIXTURE, keys, t(14400, 11400, 9));
    const flat = flattenGroups(groups, keys);
    expect(flat.map((r) => [...r.labels, r.totals.durationSeconds])).toEqual([
      ["Acme", "App", 7200],
      ["Acme", "Web", 5400],
      ["No client", "Internal", 900],
      ["No client", "No project", 300],
      ["Globex", "Site", 600],
    ]);
    const columns = summaryColumns(keys, PREFS);
    expect(columns.map((c) => c.header)).toEqual([
      "Client",
      "Project",
      "Duration",
      "Billable",
      "Entries",
    ]);
    expect(toCsv(flat, columns)).toContain("Acme,App,2:00:00,2:00:00,3\r\n");
  });
});

const ENTRIES: DetailedEntry[] = [
  {
    id: "e1",
    description: "Design review",
    projectName: "Web",
    clientName: "Acme",
    taskName: "Design",
    userName: "Alice",
    tags: ["urgent", "review"],
    billable: true,
    start: "2026-03-09T01:00:00.000Z",
    end: "2026-03-09T02:30:00.000Z",
    durationSeconds: 5400,
    rateMinor: null,
    type: "work",
    amountMinor: null,
    currency: null,
    costMinor: null,
    profitMinor: null,
  },
  {
    id: "e2",
    description: 'Call "Globex", notes',
    projectName: "Site",
    clientName: "Globex",
    taskName: null,
    userName: "Bob",
    tags: [],
    billable: false,
    start: "2026-03-09T15:30:00.000Z",
    end: "2026-03-09T16:30:00.000Z",
    durationSeconds: 3600,
    rateMinor: null,
    type: "work",
    amountMinor: null,
    currency: null,
    costMinor: null,
    profitMinor: null,
  },
  {
    id: "e3",
    description: "",
    projectName: null,
    clientName: null,
    taskName: null,
    userName: "Alice",
    tags: [],
    billable: false,
    start: "2026-03-10T04:00:00.000Z",
    end: "2026-03-10T04:15:00.000Z",
    durationSeconds: 900,
    rateMinor: null,
    type: "work",
    amountMinor: null,
    currency: null,
    costMinor: null,
    profitMinor: null,
  },
];

describe("detailed export", () => {
  it("formats the date and times in the viewer's zone and formats; a midnight crossing keeps its start date", () => {
    const csv = toCsv(ENTRIES, detailedColumns(PREFS));
    expect(csv.split("\r\n")[0]).toBe(
      "﻿Description,Type,Project,Client,Task,Person,Tags,Billable,Date,Start,End,Duration",
    );
    expect(csv).toContain(
      "Design review,Work,Web,Acme,Design,Alice,urgent; review,Yes,2026-03-09,09:00,10:30,1:30:00",
    );
    expect(csv).toContain(
      '"Call ""Globex"", notes",Work,Site,Globex,,Bob,,No,2026-03-09,23:30,00:30,1:00:00',
    );
    const us = toCsv(
      ENTRIES,
      detailedColumns({ ...PREFS, dateFormat: "dd/MM/yyyy", timeFormat: "12h" }),
    );
    expect(us).toContain(",09/03/2026,9:00 AM,10:30 AM,");
  });

  it("matches the snapshot", () => {
    expect(toCsv(ENTRIES, detailedColumns(PREFS))).toMatchSnapshot();
  });
});

describe("weekly export", () => {
  it("has a column per day and a total", () => {
    const columns = weeklyColumns(["2026-03-09", "2026-03-10"], PREFS);
    expect(columns.map((c) => c.header)).toEqual([
      "Name",
      "Mon 2026-03-09",
      "Tue 2026-03-10",
      "Total",
    ]);
    expect(
      toCsv(
        [
          {
            id: "web",
            label: "Web",
            days: [3600, 1800],
            total: 5400,
            amountMinor: 0,
            otherAmounts: [],
          },
        ],
        columns,
      ),
    ).toContain("Web,1:00:00,0:30:00,1:30:00");
  });
});

describe("formatDateInZone", () => {
  it("renders the local date in each supported format", () => {
    const instant = new Date("2026-03-09T15:30:00.000Z"); // 23:30 Manila, 11:30 New York
    expect(formatDateInZone(instant, "Asia/Manila", "yyyy-MM-dd")).toBe("2026-03-09");
    expect(formatDateInZone(instant, "Asia/Manila", "MM/dd/yyyy")).toBe("03/09/2026");
    expect(formatDateInZone(instant, "Asia/Manila", "dd.MM.yyyy")).toBe("09.03.2026");
    expect(
      formatDateInZone(new Date("2026-03-09T16:30:00.000Z"), "Asia/Manila", "dd/MM/yyyy"),
    ).toBe("10/03/2026");
  });
});

describe("toCsv formula cells", () => {
  it("defuses text a spreadsheet would run as a formula", () => {
    const cols = [{ key: "d", header: "Description", value: (r: { d: string | number }) => r.d }];
    const csv = toCsv(
      [
        { d: '=HYPERLINK("https://evil.example","Open")' },
        { d: "+1+1" },
        { d: "-2+3" },
        { d: "@SUM(A1)" },
        { d: "\tTabbed" },
        { d: "Plain = fine" },
        { d: -5 },
      ],
      cols,
    );
    expect(csv.split("\r\n").slice(1, 8)).toEqual([
      `"'=HYPERLINK(""https://evil.example"",""Open"")"`,
      "'+1+1",
      "'-2+3",
      "'@SUM(A1)",
      "'\tTabbed",
      "Plain = fine",
      "-5",
    ]);
  });
});

describe("amounts in exports", () => {
  const USD = { currency: "USD" };

  it("adds the amount after the totals in the Summary when amounts are visible", () => {
    const rows = [{ labels: ["Acme", "Web"], totals: t(5400, 3600, 3, 12050) }];
    const plain = summaryColumns(["client", "project"], PREFS);
    expect(plain.map((c) => c.header)).toEqual([
      "Client",
      "Project",
      "Duration",
      "Billable",
      "Entries",
    ]);
    const withMoney = summaryColumns(["client", "project"], PREFS, USD);
    expect(withMoney.map((c) => c.header).at(-1)).toBe("Amount (USD)");
    expect(toCsv(rows, withMoney)).toContain("Acme,Web,1:30:00,1:00:00,3,120.50");
  });

  it("adds the rate, the amount and their currency to each Detailed entry", () => {
    const entry = { ...ENTRIES[0]!, rateMinor: 8000, amountMinor: 12000, currency: "USD" };
    const columns = detailedColumns(PREFS, USD);
    // An entry is billed in its own currency, so the header cannot name one.
    expect(columns.map((c) => c.header).slice(-3)).toEqual(["Rate", "Amount", "Currency"]);
    expect(toCsv([entry], columns)).toContain(",1:30:00,80.00,120.00,USD");
    const unrated = { ...entry, rateMinor: null, amountMinor: null };
    expect(toCsv([unrated], columns).trimEnd().endsWith(",1:30:00,,,USD")).toBe(true);
    // Each amount is written with its own currency's decimals: yen has none.
    const yen = { ...entry, rateMinor: 8000, amountMinor: 12000, currency: "JPY" };
    expect(toCsv([yen], columns)).toContain(",1:30:00,8000,12000,JPY");
  });

  it("adds each Weekly row's amount after its total", () => {
    const columns = weeklyColumns(["2026-03-09"], PREFS, { currency: "JPY" });
    expect(columns.map((c) => c.header).at(-1)).toBe("Amount (JPY)");
    expect(
      toCsv(
        [
          {
            id: "web",
            label: "Web",
            days: [3600],
            total: 3600,
            amountMinor: 5000,
            otherAmounts: [],
          },
        ],
        columns,
      ),
    ).toContain("Web,1:00:00,1:00:00,5000");
  });
});

describe("currencies, cost and profit in exports (Phase 6a)", () => {
  const web = {
    labels: ["Web"],
    totals: {
      ...t(18000, 14400, 4, 400_000),
      costMinor: 210_000,
      profitMinor: 190_000,
    },
  };
  const us = {
    labels: ["Us"],
    totals: {
      ...t(5400, 5400, 2),
      otherAmounts: [{ currency: "USD", amountMinor: 6000 }],
      costMinor: 75_000,
      profitExcludedCount: 2,
    },
  };

  it("finds the other currencies of a set of totals, sorted", () => {
    expect(otherCurrencies([web.totals])).toEqual([]);
    expect(
      otherCurrencies([
        us.totals,
        { ...web.totals, otherAmounts: [{ currency: "EUR", amountMinor: 1 }] },
        us.totals,
      ]),
    ).toEqual(["EUR", "USD"]);
  });

  it("lists one amount column in the Summary for one currency", () => {
    const columns = summaryColumns(["project"], PREFS, { currency: "PHP" });
    expect(columns.map((c) => c.header)).toEqual([
      "Project",
      "Duration",
      "Billable",
      "Entries",
      "Amount (PHP)",
    ]);
    expect(toCsv([web], columns)).toContain("Web,5:00:00,4:00:00,4,4000.00\r\n");
  });

  it("lists one amount column per currency, the workspace currency first", () => {
    const columns = summaryColumns(["project"], PREFS, { currency: "PHP", others: ["USD"] });
    expect(columns.map((c) => c.header).slice(-2)).toEqual(["Amount (PHP)", "Amount (USD)"]);
    expect(toCsv([web, us], columns).split("\r\n").slice(1, 3)).toEqual([
      "Web,5:00:00,4:00:00,4,4000.00,0.00",
      "Us,1:30:00,1:30:00,2,0.00,60.00",
    ]);
  });

  it("adds Cost and Profit after the amounts for viewers who see costs", () => {
    const columns = summaryColumns(["project"], PREFS, {
      currency: "PHP",
      others: ["USD"],
      costs: true,
    });
    expect(columns.map((c) => c.header).slice(-4)).toEqual([
      "Amount (PHP)",
      "Amount (USD)",
      "Cost (PHP)",
      "Profit (PHP)",
    ]);
    // A row billed only in another currency has a cost and no profit: nothing is converted.
    expect(toCsv([web, us], columns).split("\r\n").slice(1, 3)).toEqual([
      "Web,5:00:00,4:00:00,4,4000.00,0.00,2100.00,1900.00",
      "Us,1:30:00,1:30:00,2,0.00,60.00,750.00,",
    ]);
    // Without costs the columns are not there at all.
    const plain = summaryColumns(["project"], PREFS, { currency: "PHP", costs: false });
    expect(plain.map((c) => c.header).at(-1)).toBe("Amount (PHP)");
  });

  it("gives the Profit export a margin column", () => {
    const columns = profitColumns("project", PREFS, { currency: "PHP", costs: true });
    expect(columns.map((c) => c.header)).toEqual([
      "Project",
      "Duration",
      "Billable",
      "Entries",
      "Amount (PHP)",
      "Cost (PHP)",
      "Profit (PHP)",
      "Margin %",
    ]);
    const free = {
      labels: ["Internal"],
      totals: { ...t(3600, 0, 1), costMinor: 60_000, profitMinor: -60_000 },
    };
    expect(toCsv([web, free], columns).split("\r\n").slice(1, 3)).toEqual([
      "Web,5:00:00,4:00:00,4,4000.00,2100.00,1900.00,47.5",
      // Nothing billed: a loss (a plain negative number, not a formula), and no margin.
      "Internal,1:00:00,0:00:00,1,0.00,600.00,-600.00,",
    ]);
  });

  it("adds cost and profit to Detailed entries for viewers who see costs", () => {
    const entry = {
      ...ENTRIES[0]!,
      rateMinor: 100_000,
      amountMinor: 150_000,
      currency: "PHP",
      costMinor: 90_000,
      profitMinor: 60_000,
    };
    const columns = detailedColumns(PREFS, { currency: "PHP", costs: true });
    expect(columns.map((c) => c.header).slice(-5)).toEqual([
      "Rate",
      "Amount",
      "Currency",
      "Cost (PHP)",
      "Profit (PHP)",
    ]);
    expect(toCsv([entry], columns)).toContain(",1:30:00,1000.00,1500.00,PHP,900.00,600.00");
    const foreign = { ...entry, currency: "USD", costMinor: null, profitMinor: null };
    expect(toCsv([foreign], columns).trimEnd().endsWith(",1000.00,1500.00,USD,,")).toBe(true);
  });

  it("adds a Weekly amount column per currency", () => {
    const columns = weeklyColumns(["2026-03-09"], PREFS, { currency: "PHP", others: ["USD"] });
    expect(columns.map((c) => c.header).slice(-2)).toEqual(["Amount (PHP)", "Amount (USD)"]);
    const olga = {
      id: "olga",
      label: "Olga",
      days: [14400],
      total: 14400,
      amountMinor: 200_000,
      otherAmounts: [{ currency: "USD", amountMinor: 4000 }],
    };
    expect(toCsv([olga], columns)).toContain("Olga,4:00:00,4:00:00,2000.00,40.00");
  });
});

describe("attendance export", () => {
  it("lists days, then a weekly subtotal and the person's total", () => {
    const range = { from: "2026-11-02", to: "2026-11-08" };
    const days = attendanceDays({
      ...range,
      work: new Map([
        [
          "2026-11-02",
          {
            dateKey: "2026-11-02",
            firstStart: "2026-11-02T01:00:00.000Z",
            lastEnd: "2026-11-02T10:00:00.000Z",
            workSeconds: 9 * 3600,
            breakSeconds: 0,
          },
        ],
      ]),
      capacity: DEFAULT_CAPACITY,
      holidays: new Map([["2026-11-03", "All Souls"]]),
      timeOffMinutes: new Map(),
    });
    const weeks = attendanceWeeks(days, DEFAULT_CAPACITY, 1, range);
    const rows = flattenAttendance([
      {
        userName: "Bob",
        timezone: "Asia/Manila",
        days,
        weeks,
        totals: sumAttendanceWeeks(weeks, range.from),
      },
    ]);
    const csv = toCsv(rows, attendanceColumns(PREFS));
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Person,Date,First in,Last out,Work,Breaks,Time off,Capacity,Overtime,Undertime,Holiday",
    );
    expect(lines[1]).toBe(
      "Bob,2026-11-02,09:00,18:00,9:00:00,0:00:00,0:00:00,8:00:00,1:00:00,0:00:00,",
    );
    expect(lines[2]).toBe(
      "Bob,2026-11-03,,,0:00:00,0:00:00,0:00:00,0:00:00,0:00:00,0:00:00,All Souls",
    );
    expect(lines.at(-2)).toBe(
      "Bob,Week of 2026-11-02,,,9:00:00,0:00:00,0:00:00,32:00:00,0:00:00,23:00:00,",
    );
    expect(lines.at(-1)).toBe("Bob,Total,,,9:00:00,0:00:00,0:00:00,32:00:00,0:00:00,23:00:00,");
  });
});
