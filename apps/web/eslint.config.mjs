import { baseConfig } from "@timekeep/config/eslint/base";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...baseConfig,
  {
    // A skipped e2e test still looks covered to `e2e:coverage` when the skip
    // happens inside its body (playwright --list cannot see it). Make every
    // skip visible: a deliberate one needs an eslint-disable with a reason.
    files: ["e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='test'][callee.property.name=/^(skip|fixme)$/]",
          message:
            "Skipped e2e tests hide coverage. Fix or delete the test, or disable this rule with a reason and untick its line in docs/E2E_COVERAGE.md.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
