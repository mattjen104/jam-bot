import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../.cache/vitest/api-server-merch",
  test: {
    environment: "node",
    include: [
      "test/artist-merch-fetch.test.ts",
      "test/artist-merch-discovery.test.ts",
    ],
    testTimeout: 10_000,
  },
});