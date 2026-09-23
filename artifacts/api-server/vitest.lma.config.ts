import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/lma-overlap.test.ts"],
    maxWorkers: 1,
  },
});