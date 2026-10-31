import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { functions } from "../../test/source-functions";

/**
 * Every exported server action and every workspace JSON route handler that
 * resolves a workspace must also ask the permission matrix: membership
 * (requireWorkspaceAccess) is not permission. A function passes when its body
 * calls `authorize(`, or calls a helper whose own body does: a local
 * function in the same file, or one of the shared helpers below.
 */

const SRC = path.resolve(__dirname, "..");

/** Shared helpers that authorize internally (checked below). */
const SHARED: Record<string, string> = {
  reportRoute: "server/report-route.ts",
  authorizeProject: "server/authz.ts",
  scopeForUser: "server/authz.ts",
  targetScope: "server/authz.ts",
  scopesForEntries: "server/time-entries.ts",
};

/** Exports that act on the session only, not on a workspace's data. */
const EXEMPT: Record<string, string> = {
  "server/actions/workspaces.ts#createWorkspaceAction": "creates a workspace; no workspace yet",
  "server/actions/workspaces.ts#switchWorkspaceAction": "membership is the whole question",
};

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full, test);
    return test(name) ? [full] : [];
  });
}

function authorizes(body: string, helpers: Set<string>): boolean {
  if (body.includes("authorize(")) return true;
  return [...helpers].some((h) => new RegExp(`\\b${h}\\(`).test(body));
}

function unguarded(): string[] {
  // A shared helper authorizes when its body asks the matrix, or calls a helper that does.
  const bodies = new Map(
    Object.entries(SHARED).map(([name, file]) => [
      name,
      functions(readFileSync(path.join(SRC, file), "utf8")).get(name)?.body ?? "",
    ]),
  );
  const shared = new Set(
    [...bodies]
      .filter(([, b]) => b.includes("authorize(") || b.includes("assertCan("))
      .map(([n]) => n),
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, body] of bodies) {
      if (!shared.has(name) && authorizes(body, shared)) {
        shared.add(name);
        grew = true;
      }
    }
  }
  const targets = [
    ...files(path.join(SRC, "server/actions"), (n) => n.endsWith(".ts") && !n.endsWith(".test.ts")),
    ...files(path.join(SRC, "app/api/w"), (n) => n === "route.ts"),
  ];
  const missing: string[] = [];
  for (const file of targets) {
    const source = readFileSync(file, "utf8");
    if (file.includes(`${path.sep}actions${path.sep}`) && !source.startsWith('"use server"')) {
      continue;
    }
    const fns = functions(source);
    const local = new Set(
      [...fns].filter(([, f]) => !f.exported && authorizes(f.body, shared)).map(([n]) => n),
    );
    const helpers = new Set([...shared, ...local]);
    for (const [name, fn] of fns) {
      if (!fn.exported) continue;
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (EXEMPT[`${rel}#${name}`]) continue;
      const resolvesWorkspace =
        fn.body.includes("requireWorkspaceAccess(") ||
        [...fns].some(
          ([n, f]) =>
            !f.exported && f.body.includes("requireWorkspaceAccess(") && fn.body.includes(`${n}(`),
        ) ||
        Object.keys(SHARED).some((h) => fn.body.includes(`${h}(`));
      if (!resolvesWorkspace) continue;
      if (!authorizes(fn.body, helpers)) missing.push(`${rel}#${name}`);
    }
  }
  return missing.sort();
}

describe("authorize coverage", () => {
  it("finds the actions and routes to check", () => {
    const fns = functions(readFileSync(path.join(SRC, "server/actions/time-entries.ts"), "utf8"));
    expect(fns.has("startTimerAction")).toBe(true);
    expect(fns.get("startTimerAction")?.body.length).toBeGreaterThan(20);
  });

  it("every action and workspace route that resolves a workspace also calls authorize", () => {
    expect(unguarded()).toEqual([]);
  });
});
