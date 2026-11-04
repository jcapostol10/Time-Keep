import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { functions } from "../../test/source-functions";

/**
 * The kiosk routes have no session (decision 15): each exported handler under
 * app/api/kiosk is authorized by the kiosk token, so it must resolve the
 * kiosk before anything else can run.
 */

const ROOT = path.resolve(__dirname, "../app/api/kiosk");

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routes(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("kiosk routes", () => {
  it("exist", () => {
    expect(routes(ROOT).length).toBeGreaterThanOrEqual(3);
  });

  it("resolve the kiosk from its token in every exported handler", () => {
    const missing = routes(ROOT).flatMap((file) =>
      [...functions(readFileSync(file, "utf8"))]
        .filter(([, f]) => f.exported && !f.body.includes("resolveKiosk("))
        .map(([name]) => `${path.relative(ROOT, file)}#${name}`),
    );
    expect(missing).toEqual([]);
  });
});
