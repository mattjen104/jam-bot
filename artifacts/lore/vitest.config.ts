import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    // The merge gate runs this suite concurrently with the e2e gates and the
    // api-server suites; under that CPU contention the default 5s testTimeout
    // produces random per-run flakes (each retry fails different files that
    // pass in isolation). 30s keeps genuine hangs failing while absorbing
    // saturation-induced slowness.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
