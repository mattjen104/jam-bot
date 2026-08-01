/**
 * Shared factory for vi.mock("../src/player/PlayerProvider", ...) blocks.
 *
 * Uses `importOriginal` so:
 *  - `PlayerProvider` (the React component) is kept from the real module.
 *  - `usePlayer` is stubbed with vi.fn().
 *  - Interface/type exports (stripped at runtime) pass through as-is.
 *  - A new export added to PlayerProvider does NOT require any test file change.
 *
 * Usage:
 *   vi.mock("../src/player/PlayerProvider", async (importOriginal) =>
 *     makePlayerProviderMock(importOriginal, {
 *       usePlayer: vi.fn(() => ({
 *         radio: { station: null, status: "idle", toggle: vi.fn() },
 *         ride: { active: false },
 *         spotify: { connected: false },
 *         scan: {},
 *       })),
 *     }),
 *   );
 */
import { vi } from "vitest";

type ImportOriginalFn = <T = Record<string, unknown>>() => Promise<T>;

export async function makePlayerProviderMock(
  importOriginal: ImportOriginalFn,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(actual)) {
    if (typeof val === "function") {
      // Keep React components (PascalCase: PlayerProvider) from the real module
      if (/^[A-Z]/.test(key)) {
        mocked[key] = val;
      } else {
        // Hooks (usePlayer) and any other camelCase functions — stub
        mocked[key] = vi.fn();
      }
    } else {
      // Constants and type-only exports (stripped at runtime) — keep as-is
      mocked[key] = val;
    }
  }

  return { ...mocked, ...overrides };
}
