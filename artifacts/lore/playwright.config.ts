import { defineConfig, devices } from "@playwright/test";

// When PLAYWRIGHT_WEB_SERVER_PORT is set, Playwright starts its own lore dev
// server on that dedicated port (so the gate is self-contained and doesn't
// collide with the running "artifacts/lore: web" workflow). Otherwise tests
// run against an already-running server at PLAYWRIGHT_BASE_URL / port 80.
const webServerPort = process.env.PLAYWRIGHT_WEB_SERVER_PORT
  ? Number(process.env.PLAYWRIGHT_WEB_SERVER_PORT)
  : undefined;

if (webServerPort !== undefined && (Number.isNaN(webServerPort) || webServerPort <= 0)) {
  throw new Error(
    `Invalid PLAYWRIGHT_WEB_SERVER_PORT: "${process.env.PLAYWRIGHT_WEB_SERVER_PORT}"`,
  );
}

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
    baseURL:
      webServerPort !== undefined
        ? `http://localhost:${webServerPort}`
        : (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80"),
    trace: "on-first-retry",
    headless: true,
  },
  ...(webServerPort !== undefined
    ? {
        webServer: {
          command: "pnpm run dev",
          url: `http://localhost:${webServerPort}/lore/`,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
          env: {
            ...process.env,
            PORT: String(webServerPort),
            BASE_PATH: "/lore/",
          },
        },
      }
    : {}),
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
