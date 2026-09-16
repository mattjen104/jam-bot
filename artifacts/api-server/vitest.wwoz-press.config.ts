import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../.cache/vitest/api-server-wwoz-press",
  test: {
    environment: "node",
    include: ["test/real-data/wwoz-press.real.ts"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 15_000,
    maxWorkers: 1,
    minWorkers: 1,
  },
});