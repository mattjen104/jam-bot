import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Lore Radio end-to-end tests.
 *
 * The tests run against the dev server. Set PLAYWRIGHT_BASE_URL to override
 * the base URL (e.g. the Replit preview URL). Default assumes the dev server
 * is already running on port 24224 (the PORT assigned to this artifact).
 *
 * Run:  pnpm --filter @workspace/lore run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    // baseURL is the origin only (no /lore path prefix); tests include /lore
    // explicitly. In the Replit environment the reverse proxy exposes all
    // artifacts on port 80. Set PLAYWRIGHT_BASE_URL to override (e.g. to the
    // published Replit dev-domain URL for CI).
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80",
    trace: "on-first-retry",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use the system-installed Chromium in the Replit/NixOS environment.
        // Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to override (e.g. for CI).
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : process.env.NIX_CHROMIUM_PATH
            ? { executablePath: process.env.NIX_CHROMIUM_PATH }
            : {}),
      },
    },
  ],
});
