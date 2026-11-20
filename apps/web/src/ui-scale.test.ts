import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The look of the app has a few closed rules (docs/UI.md). They are easy to
 * break one class at a time, so this reads the source and fails on a class
 * outside them, naming the file and line.
 */

const ROOTS = [path.resolve(__dirname), path.resolve(__dirname, "../../../packages/ui/src")];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

/** Every `file:line` whose text matches, relative to the repo. */
function offenders(pattern: RegExp, skip: (file: string) => boolean = () => false): string[] {
  const repo = path.resolve(__dirname, "../../..");
  return ROOTS.flatMap(sources)
    .filter((file) => !skip(file))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          pattern.test(line) ? [`${path.relative(repo, file).replaceAll("\\", "/")}:${i + 1}`] : [],
        ),
    );
}

describe("the type scale", () => {
  it("uses only its own sizes: 12, 13, 14, 16, 20, 28 and the display 32 and 48", () => {
    // The theme defines xs, meta, sm, base, xl, 2xl, display and display-lg; the
    // other Tailwind names generate nothing, and a pixel size is off the scale.
    const offScale =
      /(?<![\w-])text-(lg|3xl|4xl|5xl|6xl|7xl|8xl|9xl)(?![\w-])|text-\[\d+(\.\d+)?(px|rem)\]/;
    expect(offenders(offScale)).toEqual([]);
  });
});
