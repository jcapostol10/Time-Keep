import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { cn } from "@timekeep/ui/lib/utils";
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

  it("has no inline size under 12px (chart axes and labels)", () => {
    // Recharts takes its sizes as numbers, where no class rule can see them.
    expect(offenders(/fontSize:\s*(?:\d|1[01])(?![\d.])/)).toEqual([]);
  });

  it("merges its own size names as sizes, not as colours", () => {
    expect(cn("text-muted-foreground", "text-meta")).toBe("text-muted-foreground text-meta");
    expect(cn("text-sm", "text-meta")).toBe("text-meta");
    expect(cn("text-display", "text-display-lg")).toBe("text-display-lg");
  });
});

describe("depth", () => {
  it("keeps shadows for what floats: popovers, menus, tooltips, dialogs and sheets", () => {
    // Bars, cards and controls are separated by a border and space, not a shadow.
    const floats =
      /packages\/ui\/src\/components\/(dialog|alert-dialog|sheet|popover|dropdown-menu|select|tooltip|command|sonner)\.tsx$/;
    // The tracker's own floating layers: the description's suggestions and the bulk bar.
    const layers = /components\/tracker\/(description-input|entry-list)\.tsx$/;
    const shadow = /(?<![\w-])shadow(-(2xs|xs|sm|md|lg|xl|2xl))?(?![\w-])/;
    const floating = (file: string) => {
      const unix = file.replaceAll("\\", "/");
      return floats.test(unix) || layers.test(unix);
    };
    expect(offenders(shadow, floating)).toEqual([]);
  });
});

describe("the selected tab", () => {
  it("stands out by a border and the card fill, now that it has no shadow", () => {
    const tabs = readFileSync(
      path.resolve(__dirname, "../../../packages/ui/src/components/tabs.tsx"),
      "utf8",
    );
    expect(tabs).toContain("data-[state=active]:border-border");
    expect(tabs).toContain("data-[state=active]:bg-card");
    // A class the shadow clean-up once glued together; it matched nothing.
    expect(tabs).not.toContain("tabs-list:group-data-");
  });
});
