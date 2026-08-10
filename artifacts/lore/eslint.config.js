import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.recommended,
  {
    rules: {
      // Existing-code tolerance: goal is green lint on new code without a
      // disruptive all-at-once cleanup sweep. Warn instead of error.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-object-type": "warn",
      "prefer-const": "error",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "react-refresh/only-export-components": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // React-compiler lint rules (react-hooks v7): the codebase reached zero
      // violations, so these are errors to block regressions at merge time.
      // Remaining false positives carry targeted, justified inline disables.
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/purity": "error",
      "react-hooks/immutability": "error",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/globals": "warn",
      "no-useless-assignment": "error",
      "no-constant-binary-expression": "error",
      "no-constant-condition": ["warn", { checkLoops: false }],
    },
  },
  {
    // Test, e2e, and config files: node/dev context, looser expectations.
    files: ["test/**", "e2e/**", "*.config.ts", "*.config.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-refresh/only-export-components": "off",
      // Test harnesses legitimately use render-phase "latest value" ref
      // mirrors to observe hook APIs; the compiler rules target app code
      // (src/), where they are errors.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
    },
  },
);
