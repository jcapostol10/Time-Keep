import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `--live` (amber) means "time is running" and nothing else: the running
 * timer (the timer bar, and the top bar's chip), the calendar's now-line and
 * the live dot on Team activity. A second meaning would cost it the first, so
 * this fails on a use anywhere else. To add a place, change the rule in
 * docs/UI.md first.
 */

const SRC = path.resolve(__dirname);
const UI = path.resolve(__dirname, "../../../packages/ui/src");

const ALLOWED = new Set([
  "components/shell/timer-chip.tsx",
  "components/tracker/timer-bar.tsx",
  "components/calendar/now-line.tsx",
  "components/dashboard/live-dot.tsx",
]);

/** A Tailwind utility of the live colours, or the variables themselves. */
export const LIVE_USE =
  /(?<![\w-])(?:bg|text|border|fill|stroke|ring|outline|decoration|from|via|to|shadow|accent|caret)-live(?:-line|-foreground)?(?![\w-])|var\(--(?:color-)?live/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const uses = (root: string) =>
  sources(root)
    .filter((file) => LIVE_USE.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).replaceAll("\\", "/"));

describe("the live colour", () => {
  it("recognises a use when it sees one", () => {
    for (const text of [
      'className="bg-live"',
      "border-live-line",
      "text-live-foreground",
      "stroke: var(--live)",
    ]) {
      expect(LIVE_USE.test(text)).toBe(true);
    }
    for (const text of ["live-dot", "useLiveData", "bg-lively", "deliver-live-update"]) {
      expect(LIVE_USE.test(text)).toBe(false);
    }
  });

  it("is used by the now-line and the live dot", () => {
    const found = uses(SRC);
    expect(found).toContain("components/calendar/now-line.tsx");
    expect(found).toContain("components/dashboard/live-dot.tsx");
  });

  it("is used nowhere but where time is running", () => {
    expect(uses(SRC).filter((file) => !ALLOWED.has(file))).toEqual([]);
    // The theme defines the tokens; no shared component may spend them.
    expect(uses(UI).filter((file) => file !== "styles/globals.css")).toEqual([]);
  });

  it("has no other amber beside it: no raw amber, yellow or orange utility", () => {
    // An amber warning or star would give the colour a second meaning.
    const raw = /(?<![\w])(?:amber|yellow|orange)-\d{2,3}(?![\w])/;
    const found = [SRC, UI].flatMap((root) =>
      sources(root)
        .filter((file) => raw.test(readFileSync(file, "utf8")))
        .map((file) => path.relative(root, file).replaceAll("\\", "/")),
    );
    expect(found).toEqual([]);
  });
});
