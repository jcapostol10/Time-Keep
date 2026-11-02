import { datasetHolidays } from "@timekeep/core/holiday-import";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { setUpTimeOffCast, type TimeOffCast } from "../../../test/time-off-fixtures";
import {
  deleteHoliday,
  importHolidays,
  listHolidays,
  previewHolidayImport,
  saveHoliday,
} from "./holidays";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: TimeOffCast;
beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
});

const ph2027 = () =>
  datasetHolidays("PH", null, 2027, { includeOptional: false }).map((h) => ({
    date: h.date,
    name: h.name,
    estimated: h.estimated,
  }));

describe("importHolidays", () => {
  it("adds nothing the second time", async () => {
    const ann = await cast.viewer("ann");
    const rows = ph2027();
    const first = await importHolidays(db, ann, { country: "PH", region: null, year: 2027, rows });
    expect(first.added).toBe(rows.length);
    const second = await importHolidays(db, ann, { country: "PH", region: null, year: 2027, rows });
    expect(second.added).toBe(0);
    const listed = await listHolidays(db, await cast.viewer("bob"), 2027);
    expect(listed).toHaveLength(rows.length);
    expect(listed.find((h) => h.name === "Rizal Day")).toMatchObject({
      date: "2027-12-30",
      source: "imported: PH 2027",
      estimated: false,
    });
    expect(listed.find((h) => h.date === "2027-03-09")?.estimated).toBe(true);
  });

  it("skips a selected row added between the review and the commit", async () => {
    const ann = await cast.viewer("ann");
    const rows = ph2027();
    await saveHoliday(db, ann, {
      date: "2027-12-30",
      name: "Rizal Day",
      repeatsYearly: false,
      userIds: [],
      groupIds: [],
    });
    const result = await importHolidays(db, ann, { country: "PH", region: null, year: 2027, rows });
    expect(result.added).toBe(rows.length - 1);
  });

  it("does not double a yearly holiday from an earlier year", async () => {
    const ann = await cast.viewer("ann");
    await saveHoliday(db, ann, {
      date: "2026-12-25",
      name: "Christmas Day",
      repeatsYearly: true,
      userIds: [],
      groupIds: [],
    });
    const rows = ph2027();
    const result = await importHolidays(db, ann, { country: "PH", region: null, year: 2027, rows });
    expect(result.added).toBe(rows.length - 1);
    const christmas = (await listHolidays(db, ann, 2027)).filter(
      (h) => h.occursOn === "2027-12-25",
    );
    expect(christmas).toHaveLength(1);
  });

  it("is refused to a manager with 403", async () => {
    await expect(
      importHolidays(db, await cast.viewer("max"), {
        country: "PH",
        region: null,
        year: 2027,
        rows: ph2027(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("previewHolidayImport", () => {
  it("offers a renamed day unticked with its new name", async () => {
    const ann = await cast.viewer("ann");
    await importHolidays(db, ann, { country: "PH", region: null, year: 2027, rows: ph2027() });
    const rizal = (await listHolidays(db, ann, 2027)).find((h) => h.name === "Rizal Day")!;
    await saveHoliday(
      db,
      ann,
      { date: rizal.date, name: "Jose Rizal Day", repeatsYearly: false, userIds: [], groupIds: [] },
      rizal.id,
    );
    const preview = await previewHolidayImport(db, ann, {
      country: "PH",
      region: null,
      year: 2027,
      includeOptional: false,
    });
    expect(preview).toEqual([
      expect.objectContaining({
        name: "Rizal Day",
        selected: false,
        existingName: "Jose Rizal Day",
      }),
    ]);
  });

  it("counts a yearly holiday from an earlier year as already there", async () => {
    const ann = await cast.viewer("ann");
    await saveHoliday(db, ann, {
      date: "2026-12-25",
      name: "Christmas Day",
      repeatsYearly: true,
      userIds: [],
      groupIds: [],
    });
    const preview = await previewHolidayImport(db, ann, {
      country: "PH",
      region: null,
      year: 2027,
      includeOptional: false,
    });
    expect(preview.some((c) => c.name === "Christmas Day")).toBe(false);
  });
});

describe("saveHoliday", () => {
  it("stores a holiday for a group", async () => {
    const ann = await cast.viewer("ann");
    await saveHoliday(db, ann, {
      date: "2027-03-17",
      name: "Cebu Day",
      repeatsYearly: false,
      userIds: [],
      groupIds: [cast.cebuId],
    });
    expect(await listHolidays(db, await cast.viewer("bob"), 2027)).toMatchObject([
      { name: "Cebu Day", groupIds: [cast.cebuId], userIds: [] },
    ]);
  });

  it("lists a yearly holiday in later years on that year's date", async () => {
    const ann = await cast.viewer("ann");
    await saveHoliday(db, ann, {
      date: "2026-12-25",
      name: "Christmas Day",
      repeatsYearly: true,
      userIds: [],
      groupIds: [],
    });
    expect(await listHolidays(db, ann, 2028)).toMatchObject([
      { name: "Christmas Day", occursOn: "2028-12-25" },
    ]);
    expect(await listHolidays(db, ann, 2025)).toEqual([]);
  });

  it("deletes a holiday, and a member may not", async () => {
    const ann = await cast.viewer("ann");
    const h = await saveHoliday(db, ann, {
      date: "2027-03-17",
      name: "Cebu Day",
      repeatsYearly: false,
      userIds: [],
      groupIds: [],
    });
    await expect(deleteHoliday(db, await cast.viewer("bob"), h.id)).rejects.toMatchObject({
      status: 403,
    });
    await deleteHoliday(db, ann, h.id);
    expect(await listHolidays(db, ann, 2027)).toEqual([]);
  });
});
