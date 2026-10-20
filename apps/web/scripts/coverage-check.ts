/**
 * Keeps docs/E2E_COVERAGE.md honest: every ticked line must name a test that
 * Playwright actually lists. Run with `pnpm --filter @timekeep/web e2e:coverage`.
 *
 * Line format in the coverage list:
 *   - [x] What the user can do — `spec-file.spec.ts` › "exact test title"
 *     (a spec in a subfolder of e2e/ is named by its path, e.g. `team/invite.spec.ts`)
 *   - [ ] What the user can do — gap
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CoverageLine {
  /** 1-based line number in the markdown file. */
  line: number;
  ticked: boolean;
  text: string;
  spec?: string;
  title?: string;
}

const ITEM = /^- \[( |x|X)\] (.+)$/;
const REFERENCE = /^(.*?)\s+—\s+`([^`]+)`\s+›\s+"((?:[^"\\]|\\.)*)"\s*$/;
const GAP = /^(.*?)\s+—\s+gap\s*$/i;

export function parseCoverage(markdown: string): CoverageLine[] {
  const lines: CoverageLine[] = [];
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const item = ITEM.exec(raw.trim());
    if (!item) return;
    const ticked = item[1] !== " ";
    const body = item[2] ?? "";
    const ref = REFERENCE.exec(body);
    if (ref) {
      lines.push({
        line: index + 1,
        ticked,
        text: (ref[1] ?? "").trim(),
        spec: ref[2],
        title: (ref[3] ?? "").replace(/\\(.)/g, "$1"),
      });
      return;
    }
    const gap = GAP.exec(body);
    lines.push({ line: index + 1, ticked, text: (gap ? gap[1] : body)?.trim() ?? "" });
  });
  return lines;
}

interface ReportSpec {
  title: string;
  file: string;
  tests: { expectedStatus: string }[];
}

interface ReportSuite {
  title: string;
  specs?: ReportSpec[];
  suites?: ReportSuite[];
}

/**
 * Reads `playwright test --list --reporter=json` and keys `${specPath}::${title}`
 * for every test that will run, where specPath is the file's path under e2e/
 * (so same-named specs in two folders stay apart). Titles may themselves contain " › ", so every
 * suffix of the describe/test path is keyed. Tests marked `test.skip` or
 * `test.fixme` are left out: a test that never runs covers nothing. (A
 * `test.skip()` call inside a test body only shows up at run time.)
 */
export function parseListedTests(reportJson: string): Set<string> {
  const report = JSON.parse(reportJson) as { suites?: ReportSuite[] };
  if (!Array.isArray(report.suites)) throw new Error("not a Playwright JSON report");
  const keys = new Set<string>();
  const walk = (suite: ReportSuite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      if (spec.tests.every((t) => t.expectedStatus === "skipped")) continue;
      // The spec's path under e2e/, with forward slashes on every platform.
      const file = spec.file.replace(/\\/g, "/");
      const segments = [...path, spec.title];
      for (let i = 0; i < segments.length; i++) {
        keys.add(`${file}::${segments.slice(i).join(" › ")}`);
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
  };
  // The top-level suites are files; their titles are not part of a test's name.
  for (const fileSuite of report.suites) walk(fileSuite, []);
  return keys;
}

/** Ticked lines that do not point at a listed test. */
export function findStale(lines: CoverageLine[], listed: Set<string>): CoverageLine[] {
  return lines.filter(
    (l) => l.ticked && (!l.spec || !l.title || !listed.has(`${l.spec}::${l.title}`)),
  );
}

function main() {
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const listFile = path.resolve(webRoot, "../../docs/E2E_COVERAGE.md");
  // A fixed command string: nothing user-controlled reaches the shell.
  const result = spawnSync("pnpm exec playwright test --list --reporter=json", {
    cwd: webRoot,
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    console.error("[coverage] playwright --list failed");
    process.exit(1);
  }
  const lines = parseCoverage(readFileSync(listFile, "utf8"));
  const stale = findStale(lines, parseListedTests(result.stdout));
  const covered = lines.filter((l) => l.ticked).length;
  console.info(
    `[coverage] covered ${covered} / total ${lines.length} (gaps ${lines.length - covered})`,
  );
  if (stale.length > 0) {
    for (const l of stale) {
      console.error(
        `[coverage] E2E_COVERAGE.md:${l.line} "${l.text}" names a test that does not exist or is skipped: ${l.spec ?? "?"} › "${l.title ?? "?"}"`,
      );
    }
    process.exit(1);
  }
}

/**
 * True when `argv1` (the script path Node was started with) is this module.
 * Node gives modules their real path, so a path through a symlink or junction
 * must be resolved before comparing.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) main();
