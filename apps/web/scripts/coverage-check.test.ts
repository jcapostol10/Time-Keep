import { describe, expect, it } from "vitest";

import { findStale, parseCoverage, parseListedTests } from "./coverage-check";

describe("parseCoverage", () => {
  it("reads a ticked line with its spec file and test title", () => {
    const [line] = parseCoverage(
      '- [x] Start a timer — `tracker.spec.ts` › "start, reload and stop a timer"',
    );
    expect(line).toMatchObject({
      ticked: true,
      text: "Start a timer",
      spec: "tracker.spec.ts",
      title: "start, reload and stop a timer",
    });
  });

  it("reads a gap without a spec", () => {
    const [line] = parseCoverage("- [ ] Create a project inline — gap");
    expect(line).toMatchObject({ ticked: false, text: "Create a project inline" });
    expect(line?.spec).toBeUndefined();
    expect(line?.title).toBeUndefined();
  });

  it("ignores headings, prose and other bullets, and records line numbers", () => {
    const lines = parseCoverage(
      [
        "# Coverage",
        "",
        "Some prose.",
        "- a plain bullet",
        '- [x] One — `a.spec.ts` › "one"',
        "## Section",
        "- [ ] Two — gap",
      ].join("\n"),
    );
    expect(lines.map((l) => [l.line, l.ticked])).toEqual([
      [5, true],
      [7, false],
    ]);
  });

  it("keeps titles containing › and escaped quotes intact", () => {
    const [line] = parseCoverage('- [x] Odd title — `x.spec.ts` › "a › b says \\"hi\\""');
    expect(line?.title).toBe('a › b says "hi"');
  });
});

describe("parseListedTests", () => {
  it("keys each listed test by spec file and its own title", () => {
    const listed = parseListedTests(
      [
        "Listing tests:",
        "  [chromium] › tracker.spec.ts:36:7 › time tracker › start, reload and stop a timer",
        "  [chromium] › e2e\\auth.spec.ts:7:7 › authentication › sign up",
        "  [chromium] › e2e/fixtures.spec.ts:3:5 › freshUser starts signed in",
        "Total: 3 tests in 3 files",
      ].join("\n"),
    );
    for (const key of [
      "auth.spec.ts::sign up",
      "fixtures.spec.ts::freshUser starts signed in",
      "tracker.spec.ts::start, reload and stop a timer",
    ]) {
      expect(listed.has(key)).toBe(true);
    }
    // A describe block alone is not a test.
    expect(listed.has("tracker.spec.ts::time tracker")).toBe(false);
    expect(listed.has("tracker.spec.ts::start")).toBe(false);
  });
});

describe("findStale", () => {
  it("returns ticked lines whose test no longer exists, ignoring gaps", () => {
    const lines = parseCoverage(
      [
        '- [x] Kept — `a.spec.ts` › "kept"',
        '- [x] Renamed — `a.spec.ts` › "old name"',
        '- [x] Wrong file — `b.spec.ts` › "kept"',
        "- [ ] Not yet — gap",
      ].join("\n"),
    );
    const stale = findStale(lines, new Set(["a.spec.ts::kept", "a.spec.ts::new name"]));
    expect(stale.map((l) => l.text)).toEqual(["Renamed", "Wrong file"]);
  });

  it("treats a ticked line without a test reference as stale", () => {
    const lines = parseCoverage("- [x] Ticked but unnamed — gap");
    expect(findStale(lines, new Set()).map((l) => l.text)).toEqual(["Ticked but unnamed"]);
  });
});
