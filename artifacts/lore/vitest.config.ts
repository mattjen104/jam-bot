import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../.cache/vitest/lore",
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    retry: 1,
    bail: 1,
    // The merge gate runs this suite concurrently with the e2e gates and the
    // api-server suites; under that CPU contention the default 5s testTimeout
    // produces random per-run flakes (each retry fails different files that
    // pass in isolation). 30s keeps genuine hangs failing while absorbing
    // saturation-induced slowness.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Vitest 4 dropped `environmentMatchGlobs`; projects are the supported way
    // to route files to environments by glob. All .test.tsx files (component
    // tests) run in jsdom without needing a per-file pragma; .test.ts files
    // (pure logic tests) stay in node. `extends: true` inherits the root
    // resolve/esbuild config and the retry/bail/timeout settings above.
    projects: [
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["test/**/*.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
