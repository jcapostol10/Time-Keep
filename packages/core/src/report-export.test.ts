import { describe, expect, it } from "vitest";

import type { ViewerPrefs } from "./prefs";
import {
  type DetailedEntry,
  detailedColumns,
  type ExportColumn,
  flattenGroups,
  summaryColumns,
  toCsv,
  weeklyColumns,
} from "./report-export";
import { type GroupKey, groupRows, type ReportRow, type ReportTotals } from "./reports";
import { formatDateInZone } from "./time";

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
  durationSeconds,
  billableSeconds,
  entryCount,
  amountMinor,
  unratedCount: 0,
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
    amountMinor: null,
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
    amountMinor: null,
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
    amountMinor: null,
  },
];

describe("detailed export", () => {
  it("formats the date and times in the viewer's zone and formats; a midnight crossing keeps its start date", () => {
    const csv = toCsv(ENTRIES, detailedColumns(PREFS));
    expect(csv.split("\r\n")[0]).toBe(
      "﻿Description,Project,Client,Task,Person,Tags,Billable,Date,Start,End,Duration",
    );
    expect(csv).toContain(
      "Design review,Web,Acme,Design,Alice,urgent; review,Yes,2026-03-09,09:00,10:30,1:30:00",
    );
    expect(csv).toContain(
      '"Call ""Globex"", notes",Site,Globex,,Bob,,No,2026-03-09,23:30,00:30,1:00:00',
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
        [{ id: "web", label: "Web", days: [3600, 1800], total: 5400, amountMinor: 0 }],
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

  it("adds the rate and the amount to each Detailed entry", () => {
    const entry = { ...ENTRIES[0]!, rateMinor: 8000, amountMinor: 12000 };
    const columns = detailedColumns(PREFS, USD);
    expect(columns.map((c) => c.header).slice(-2)).toEqual(["Rate (USD)", "Amount (USD)"]);
    expect(toCsv([entry], columns)).toContain(",1:30:00,80.00,120.00");
    const unrated = { ...entry, rateMinor: null, amountMinor: null };
    expect(toCsv([unrated], columns).trimEnd().endsWith(",1:30:00,,")).toBe(true);
  });

  it("adds each Weekly row's amount after its total", () => {
    const columns = weeklyColumns(["2026-03-09"], PREFS, { currency: "JPY" });
    expect(columns.map((c) => c.header).at(-1)).toBe("Amount (JPY)");
    expect(
      toCsv([{ id: "web", label: "Web", days: [3600], total: 3600, amountMinor: 5000 }], columns),
    ).toContain("Web,1:00:00,1:00:00,5000");
  });
});
