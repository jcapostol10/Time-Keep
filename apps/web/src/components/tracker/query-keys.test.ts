import { describe, expect, it } from "vitest";

import { trackerKeys, trackerUrls } from "./query-keys";

describe("report query keys", () => {
  it("sit under the tracker's entries prefix, so any entry write refetches them", () => {
    const key = trackerKeys.report("acme", "summary", "preset=this-week");
    const prefix = trackerKeys.entries("acme");
    expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    expect(key).toEqual(["tracker", "acme", "entries", "report", "summary", "preset=this-week"]);
  });

  it("build the report URLs from the serialised query", () => {
    expect(trackerUrls.report("acme", "detailed", "preset=today&sort=duration")).toBe(
      "/api/w/acme/reports/detailed?preset=today&sort=duration",
    );
    expect(trackerUrls.reportOptions("acme")).toBe("/api/w/acme/reports/options");
  });
});
