import { readFileSync } from "node:fs";
import path from "node:path";

import { renderPermissionsMarkdown } from "@timekeep/core";
import { describe, expect, it } from "vitest";

describe("docs/PERMISSIONS.md", () => {
  it("matches the permission matrix (run pnpm permissions:doc)", () => {
    const file = path.resolve(__dirname, "../../../../docs/PERMISSIONS.md");
    let current = "";
    try {
      current = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    } catch {
      // Missing file: the comparison below fails with the same message.
    }
    expect(current, "docs/PERMISSIONS.md is stale: run pnpm permissions:doc").toBe(
      renderPermissionsMarkdown(),
    );
  });
});
