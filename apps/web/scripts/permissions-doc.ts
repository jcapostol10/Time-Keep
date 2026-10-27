/**
 * Writes docs/PERMISSIONS.md from the permission matrix in packages/core.
 * Run with `pnpm permissions:doc` after changing the matrix;
 * `src/server/permissions-doc.test.ts` fails while the file is stale.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderPermissionsMarkdown } from "@timekeep/core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const target = path.join(root, "docs", "PERMISSIONS.md");
writeFileSync(target, renderPermissionsMarkdown(), "utf8");
console.info(`[permissions] wrote ${path.relative(root, target)}`);
