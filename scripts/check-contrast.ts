/**
 * Reads the theme tokens (packages/ui/src/styles/globals.css) and fails when a
 * text pair is under WCAG AA (4.5:1), or a graphic that carries meaning is
 * under 3:1, in either theme. Run by CI and `pnpm contrast:check`.
 *
 *   node scripts/check-contrast.ts
 *
 * Tokens are hex or rgba(); a translucent colour is blended over the theme's
 * background first. Anything else is an error, so a token cannot quietly
 * leave the check.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type Rgb = [number, number, number];
type Tokens = Map<string, string>;

const FILE = path.resolve(import.meta.dirname, "../packages/ui/src/styles/globals.css");

/** `[foreground, background]`: text that must read at 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "muted"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary", "background"],
  ["primary", "card"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["destructive-foreground", "destructive"],
  ["sidebar-foreground", "sidebar"],
  ["live-foreground", "live"],
];

/** Lines, rings and chart marks that carry meaning: 3:1 against what they sit on. */
const GRAPHIC_PAIRS: [string, string][] = [
  ["ring", "background"],
  ["ring", "card"],
  ["live-line", "background"],
  ["live-line", "card"],
  ["chart-1", "card"],
  ["chart-2", "card"],
  ["chart-3", "card"],
  ["chart-4", "card"],
  ["chart-5", "card"],
];

function block(css: string, selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No "${selector}" block in ${FILE}`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const tokens: Tokens = new Map();
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens.set(match[1]!, match[2]!.trim());
  }
  return tokens;
}

function parse(value: string, name: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+%?))?\s*\)$/.exec(value);
  if (rgba) {
    const a = rgba[4];
    const alpha = a === undefined ? 1 : a.endsWith("%") ? Number.parseFloat(a) / 100 : Number(a);
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha };
  }
  throw new Error(`unparsed token --${name}: ${value} (use hex or rgba())`);
}

function resolve(tokens: Tokens, name: string): Rgb {
  const raw = tokens.get(name);
  if (raw === undefined) throw new Error(`missing token --${name}`);
  const { rgb, alpha } = parse(raw, name);
  if (alpha >= 1) return rgb;
  const under = resolve(tokens, "background");
  return rgb.map((c, i) => Math.round(c * alpha + under[i]! * (1 - alpha))) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(FILE, "utf8");
const themes: [string, Tokens][] = [
  ["light", block(css, ":root")],
  ["dark", new Map([...block(css, ":root"), ...block(css, ".dark")])],
];

const failures: string[] = [];
for (const [theme, tokens] of themes) {
  const check = (pairs: [string, string][], minimum: number, kind: string) => {
    for (const [fg, bg] of pairs) {
      let line: string;
      try {
        const r = ratio(resolve(tokens, fg), resolve(tokens, bg));
        const ok = r >= minimum;
        line = `${ok ? "  ok  " : " FAIL "} ${theme.padEnd(5)} ${kind} ${`${fg} on ${bg}`.padEnd(40)} ${r.toFixed(2)}:1 (needs ${minimum})`;
        if (!ok) failures.push(line.trim());
      } catch (error) {
        line = ` FAIL  ${theme.padEnd(5)} ${kind} ${fg} on ${bg}: ${(error as Error).message}`;
        failures.push(line.trim());
      }
      console.info(line);
    }
  };
  check(TEXT_PAIRS, 4.5, "text   ");
  check(GRAPHIC_PAIRS, 3, "graphic");
}

if (failures.length > 0) {
  console.error(`\n${failures.length} pair${failures.length === 1 ? "" : "s"} under WCAG AA:`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.info("\nEvery pair meets WCAG AA.");
