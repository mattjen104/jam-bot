import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Server convention: use the structured logger, never bare console.
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Existing-code tolerance: warn-only on rules whose violations predate
      // lint; fix on touch rather than in a single sweep.
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "require-yield": "warn",
      "preserve-caught-error": "warn",
      "no-control-regex": "warn",
    },
  },
  {
    // Legacy trees written before the lint gate: hundreds of console.log
    // call sites (poller/ingestion progress logs). New code outside these
    // trees must use the structured logger; migrate these on touch.
    files: ["src/lore/**", "src/routes/**"],
    rules: { "no-console": "off" },
  },
  {
    // Tests and build scripts may log freely.
    files: ["test/**", "build.ts", "*.config.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
