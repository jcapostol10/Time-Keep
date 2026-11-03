import { describe, expect, it } from "vitest";
import {
  countryForTimezone,
  datasetHolidays,
  listCountries,
  listRegions,
  planHolidayImport,
  type DatasetHoliday,
} from "./holiday-import";

describe("countryForTimezone", () => {
  it("suggests a country from the workspace timezone", () => {
    expect(countryForTimezone("Asia/Manila")).toBe("PH");
    expect(countryForTimezone("America/New_York")).toBe("US");
    expect(countryForTimezone("Etc/UTC")).toBeNull();
  });
});

describe("listCountries and listRegions", () => {
  it("lists countries by name", () => {
    const countries = listCountries();
    expect(countries.length).toBeGreaterThan(150);
    expect(countries).toContainEqual({ code: "PH", name: "Philippines" });
    const names = countries.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("lists a country's regions", () => {
    expect(listRegions("US").map((r) => r.code)).toContain("CA");
  });
});

describe("datasetHolidays", () => {
  const ph = datasetHolidays("PH", null, 2027, { includeOptional: false });

  it("keeps public days with their local date", () => {
    expect(ph).toContainEqual({
      date: "2027-12-30",
      name: "Rizal Day",
      type: "public",
      estimated: false,
    });
  });

  it("marks Islamic-calendar days as estimated", () => {
    expect(ph.find((h) => h.date === "2027-03-09")).toMatchObject({ estimated: true });
  });

  it("leaves optional days out unless asked", () => {
    expect(ph.some((h) => h.name === "Chinese New Year")).toBe(false);
    const all = datasetHolidays("PH", null, 2027, { includeOptional: true });
    expect(all.some((h) => h.name === "Chinese New Year")).toBe(true);
    expect(all.some((h) => h.type === "observance")).toBe(true);
  });

  it("never imports school holidays", () => {
    const de = datasetHolidays("DE", null, 2027, { includeOptional: true });
    expect(de.length).toBeGreaterThan(0);
    expect(de.some((h) => h.type === "school")).toBe(false);
  });

  it("adds a region's own days", () => {
    const us = datasetHolidays("US", null, 2027, { includeOptional: false });
    const ca = datasetHolidays("US", "CA", 2027, { includeOptional: false });
    expect(ca.length).toBeGreaterThan(us.length);
  });
});

describe("planHolidayImport", () => {
  const rows: DatasetHoliday[] = [
    { date: "2027-12-30", name: "Rizal Day", type: "public", estimated: false },
    { date: "2027-11-30", name: "Bonifacio Day", type: "public", estimated: false },
    { date: "2027-06-12", name: "Independence Day", type: "public", estimated: false },
  ];

  it("drops a row already imported and flags a renamed one", () => {
    const plan = planHolidayImport(rows, [
      { date: "2027-12-30", name: "Rizal Day" },
      { date: "2027-11-30", name: "Andres Bonifacio Day" },
    ]);
    expect(plan).toEqual([
      { ...rows[1], selected: false, existingName: "Andres Bonifacio Day" },
      { ...rows[2], selected: true, existingName: null },
    ]);
  });
});
