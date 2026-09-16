import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../.cache/vitest/api-server-station-press",
  test: {
    environment: "node",
    include: ["test/real-data/station-press-batch.real.ts"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 240_000,
    hookTimeout: 30_000,
    maxWorkers: 1,
    minWorkers: 1,
  },
});