import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

import { baseConfig } from "./base.js";

/** Base config plus React hooks rules, for React libraries that are not Next.js apps. */
export const reactConfig = tseslint.config(...baseConfig, {
  files: ["**/*.{ts,tsx}"],
  plugins: { "react-hooks": reactHooks },
  rules: {
    ...reactHooks.configs.recommended.rules,
  },
});

export default reactConfig;
