import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws when imported outside React Server Components.
      "server-only": path.resolve(import.meta.dirname, "test/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "e2e/**/*.unit.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Integration tests share one database; run files serially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
