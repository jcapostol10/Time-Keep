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

/** A minimal `playwright test --list --reporter=json` report. */
function report(files: { file: string; describe?: string; specs: [string, string][] }[]) {
  return JSON.stringify({
    suites: files.map(({ file, describe, specs }) => {
      const leaf = specs.map(([title, expectedStatus]) => ({
        title,
        file,
        tests: [{ expectedStatus, status: "skipped" }],
      }));
      return describe
        ? { title: file, file, specs: [], suites: [{ title: describe, file, specs: leaf }] }
        : { title: file, file, specs: leaf };
    }),
  });
}

describe("parseListedTests", () => {
  it("keys each listed test by spec file and its own title", () => {
    const listed = parseListedTests(
      report([
        {
          file: "tracker.spec.ts",
          describe: "time tracker",
          specs: [["start, reload and stop a timer", "passed"]],
        },
        { file: "auth\\auth.spec.ts", describe: "authentication", specs: [["sign up", "passed"]] },
        { file: "team/invite.spec.ts", specs: [["invite a member", "passed"]] },
        { file: "fixtures.spec.ts", specs: [["freshUser starts signed in", "passed"]] },
      ]),
    );
    for (const key of [
      "auth.spec.ts::sign up",
      "invite.spec.ts::invite a member",
      "fixtures.spec.ts::freshUser starts signed in",
      "tracker.spec.ts::start, reload and stop a timer",
      "tracker.spec.ts::time tracker › start, reload and stop a timer",
    ]) {
      expect(listed.has(key)).toBe(true);
    }
    // A describe block alone is not a test.
    expect(listed.has("tracker.spec.ts::time tracker")).toBe(false);
  });

  it("leaves out skipped and fixme tests, so they never count as covered", () => {
    const listed = parseListedTests(
      report([
        {
          file: "a.spec.ts",
          specs: [
            ["runs", "passed"],
            ["skipped", "skipped"],
          ],
        },
      ]),
    );
    expect(listed.has("a.spec.ts::runs")).toBe(true);
    expect(listed.has("a.spec.ts::skipped")).toBe(false);
  });

  it("rejects output that is not a JSON report", () => {
    expect(() => parseListedTests("Listing tests: Total: 0 tests")).toThrow();
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
