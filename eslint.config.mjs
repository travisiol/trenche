import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // build dir of the second dev server (TRENCH_DIST_DIR=.next-test, see next.config.ts)
    ".next-test/**",
    ".next-qa/**",
    ".next-qa-build/**",
    ".next-rpc/**",
    ".next-speed/**",
    ".next-claim/**",
    ".next-share/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
