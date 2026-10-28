import { describe, expect, it } from "vitest";

import { trackerKeys, trackerUrls } from "./query-keys";

describe("another person's entry keys", () => {
  it("never share the viewer's own keys beyond the invalidation prefix", () => {
    const mine = trackerKeys.entries("acme");
    const theirs = trackerKeys.entries("acme", "u2");
    expect(mine).toEqual(["tracker", "acme", "entries", "me"]);
    expect(theirs).toEqual(["tracker", "acme", "entries", "u2"]);
    expect(trackerKeys.range("acme", "a", "b", "u2")).toEqual([
      "tracker",
      "acme",
      "entries",
      "u2",
      "range",
      "a",
      "b",
    ]);
    expect(trackerKeys.range("acme", "a", "b", "u2").slice(0, 4)).not.toEqual([...mine]);
    expect(trackerUrls.range("acme", "a", "b", "u2")).toContain("&userId=u2");
    expect(trackerUrls.entries("acme", null, "u2")).toBe("/api/w/acme/time-entries?userId=u2");
    expect(trackerUrls.entries("acme", "2026", "u2")).toBe(
      "/api/w/acme/time-entries?before=2026&userId=u2",
    );
    expect(trackerUrls.options("acme")).toBe("/api/w/acme/tracker-options");
  });
});

describe("report query keys", () => {
  it("sit under the tracker's entries prefix, so any entry write refetches them", () => {
    const key = trackerKeys.report("acme", "summary", "preset=this-week");
    const prefix = trackerKeys.allEntries("acme");
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
