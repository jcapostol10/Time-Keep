import { baseConfig } from "@timekeep/config/eslint/base";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...baseConfig,
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // A skipped e2e test still looks covered to `e2e:coverage` when the skip
          // happens inside its body (playwright --list cannot see it). Make every
          // skip visible: a deliberate one needs an eslint-disable with a reason.
          selector:
            "CallExpression[callee.object.name='test'][callee.property.name=/^(skip|fixme)$/]",
          message:
            "Skipped e2e tests hide coverage. Fix or delete the test, or disable this rule with a reason and untick its line in docs/E2E_COVERAGE.md.",
        },
        // A failed assertion's diff lands in the Playwright report, which is public
        // on a preview run, where the cookies and request headers carry Vercel's
        // protection bypass. Whole cookie and header dumps stay out of the specs
        // (scripts/report-guard.ts is the backstop before an upload).
        {
          selector: "CallExpression[callee.property.name=/^(cookies|allHeaders|headersArray)$/]",
          message:
            "Cookie and header dumps leak the preview's bypass token through a failed assertion. Use cookieNames() or appCookieNames() from e2e/helpers/cookies.ts, or read one header by name.",
        },
        {
          selector:
            ":matches(CallExpression[callee.name='expect'] > CallExpression, CallExpression[callee.name='expect'] > AwaitExpression > CallExpression)[callee.property.name='headers']",
          message:
            "Never assert on whole headers: a failed assertion's diff is public. Read one header by name.",
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
