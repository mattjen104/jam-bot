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
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-object-type": "warn",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "react-refresh/only-export-components": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // New React-compiler lint rules (react-hooks v7): valuable signals but
      // the codebase predates them; warn-only so new code gets feedback
      // without a disruptive cleanup sweep. rules-of-hooks stays an error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/globals": "warn",
      "no-useless-assignment": "warn",
      "no-constant-binary-expression": "warn",
      "no-constant-condition": ["warn", { checkLoops: false }],
    },
  },
  {
    // Test, e2e, and config files: node/dev context, looser expectations.
    files: ["test/**", "e2e/**", "*.config.ts", "*.config.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-refresh/only-export-components": "off",
    },
  },
);
