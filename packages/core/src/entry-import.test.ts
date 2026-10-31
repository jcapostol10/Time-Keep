import { describe, expect, it } from "vitest";

import {
  autoMapColumns,
  type ColumnMapping,
  parseImportDate,
  parseImportRows,
} from "./entry-import";

const MANILA = "Asia/Manila";
const FULL: ColumnMapping = {
  date: 0,
  start: 1,
  end: 2,
  duration: 3,
  description: 4,
  project: 5,
  client: 6,
  task: 7,
  tags: 8,
  billable: 9,
  email: 10,
};
const row = (over: Partial<Record<keyof ColumnMapping, string>> = {}): string[] => {
  const cells = {
    date: "2026-03-09",
    start: "09:00",
    end: "10:30",
    duration: "",
    description: "Design review",
    project: "Web",
    client: "Acme",
    task: "Design",
    tags: "urgent; review",
    billable: "yes",
    email: "",
    ...over,
  };
  return (Object.keys(FULL) as (keyof ColumnMapping)[]).map((k) => cells[k]);
};
const parse = (rows: string[][], dateFormat: "yyyy-MM-dd" | "dd/MM/yyyy" = "yyyy-MM-dd") =>
  parseImportRows(rows, FULL, { timezone: MANILA, dateFormat });

describe("autoMapColumns", () => {
  it("matches header names loosely, each header once", () => {
    expect(
      autoMapColumns(["Date", "Start time", "End Time", "Description", "Project", "Tags", "Billable", "User email"]),
    ).toEqual({ date: 0, start: 1, end: 2, description: 3, project: 4, tags: 5, billable: 6, email: 7 });
    expect(autoMapColumns(["Day", "From", "To", "Hours", "What", "Customer"])).toEqual({
      date: 0,
      start: 1,
      end: 2,
      duration: 3,
      description: 4,
      client: 5,
    });
    expect(autoMapColumns(["Colour", "Mood"])).toEqual({});
  });
});

describe("parseImportDate", () => {
  it("reads ISO always and the chosen format", () => {
    expect(parseImportDate("2026-03-09", "dd/MM/yyyy")).toBe("2026-03-09");
    expect(parseImportDate("09/03/2026", "dd/MM/yyyy")).toBe("2026-03-09");
    expect(parseImportDate("03/09/2026", "MM/dd/yyyy")).toBe("2026-03-09");
    expect(parseImportDate("9.3.2026", "dd.MM.yyyy")).toBe("2026-03-09");
    expect(parseImportDate("03/09/2026", "dd/MM/yyyy")).toBe("2026-09-03");
    expect(parseImportDate("2026-02-30", "yyyy-MM-dd")).toBeNull();
    expect(parseImportDate("yesterday", "yyyy-MM-dd")).toBeNull();
  });
});

describe("parseImportRows", () => {
  it("builds instants in the given zone and reads tags, billable and email", () => {
    const [r] = parse([row({ email: "Bob@Example.com" })]);
    expect(r).toMatchObject({
      line: 2,
      description: "Design review",
      project: "Web",
      client: "Acme",
      task: "Design",
      tags: ["urgent", "review"],
      billable: true,
      email: "bob@example.com",
      error: null,
    });
    expect(r!.start?.toISOString()).toBe("2026-03-09T01:00:00.000Z");
    expect(r!.end?.toISOString()).toBe("2026-03-09T02:30:00.000Z");
  });

  it("an end before the start is the next day; a duration stands in for a missing end", () => {
    const [crossing, byDuration, both] = parse([
      row({ start: "23:30", end: "00:30" }),
      row({ end: "", duration: "1:30" }),
      row({ end: "10:00", duration: "5h" }),
    ]);
    expect(crossing!.end?.toISOString()).toBe("2026-03-09T16:30:00.000Z");
    expect(byDuration!.end?.toISOString()).toBe("2026-03-09T02:30:00.000Z");
    expect(both!.end?.toISOString()).toBe("2026-03-09T02:00:00.000Z");
  });

  it("refuses an end equal to the start instead of reading it as 24 hours", () => {
    const [same] = parse([row({ start: "09:00", end: "09:00" })]);
    expect(same!.error).toBe("Line 2: the end time equals the start time");
    expect(same!.end).toBeNull();
  });

  it("reads the chosen date format and splits tags on commas too", () => {
    const [r] = parse([row({ date: "09/03/2026", tags: "a, b,a" })], "dd/MM/yyyy");
    expect(r!.error).toBeNull();
    expect(r!.start?.toISOString()).toBe("2026-03-09T01:00:00.000Z");
    expect(r!.tags).toEqual(["a", "b"]);
    for (const [text, billable] of [
      ["true", true],
      ["1", true],
      ["x", true],
      ["Y", true],
      ["no", false],
      ["", false],
    ] as const) {
      expect(parse([row({ billable: text })])[0]!.billable).toBe(billable);
    }
  });

  it("names the line and the field of every problem", () => {
    const rows = parse([
      row({ date: "" }),
      row({ date: "2026-13-01" }),
      row({ start: "" }),
      row({ start: "25:99" }),
      row({ end: "soon" }),
      row({ end: "", duration: "lots" }),
      row({ end: "", duration: "" }),
    ]);
    expect(rows.map((r) => r.error)).toEqual([
      "Line 2: missing date",
      "Line 3: invalid date",
      "Line 4: missing start time",
      "Line 5: invalid start time",
      "Line 6: invalid end time",
      "Line 7: invalid duration",
      "Line 8: missing end time or duration",
    ]);
  });
});
