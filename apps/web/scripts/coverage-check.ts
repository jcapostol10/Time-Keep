/**
 * Keeps docs/E2E_COVERAGE.md honest: every ticked line must name a test that
 * Playwright actually lists. Run with `pnpm --filter @timekeep/web e2e:coverage`.
 *
 * Line format in the coverage list:
 *   - [x] What the user can do — `spec-file.spec.ts` › "exact test title"
 *   - [ ] What the user can do — gap
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const LISTED = /^\s*\[[^\]]+\]\s+›\s+(.+?):\d+:\d+\s+›\s+(.+)$/;

/**
 * Keys `${specFile}::${title}` for every listed test. Titles may themselves
 * contain " › ", so every suffix of the describe/test path is keyed.
 */
export function parseListedTests(listOutput: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of listOutput.split(/\r?\n/)) {
    const match = LISTED.exec(raw);
    if (!match) continue;
    const file = (match[1] ?? "").split(/[\\/]/).pop() ?? "";
    const segments = (match[2] ?? "").split(" › ");
    for (let i = 0; i < segments.length; i++) {
      keys.add(`${file}::${segments.slice(i).join(" › ")}`);
    }
  }
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
  const result = spawnSync("pnpm exec playwright test --list", {
    cwd: webRoot,
    encoding: "utf8",
    shell: true,
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
        `[coverage] E2E_COVERAGE.md:${l.line} "${l.text}" names a test that does not exist: ${l.spec ?? "?"} › "${l.title ?? "?"}"`,
      );
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
