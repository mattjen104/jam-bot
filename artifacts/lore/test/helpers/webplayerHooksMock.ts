/**
 * Shared factory for vi.mock("../src/webplayer/hooks", ...) blocks.
 *
 * Uses `importOriginal` so:
 *  - Every `use*` hook is automatically stubbed with vi.fn().
 *  - Interface/type exports (stripped at runtime) pass through as-is.
 *  - A new export added to webplayer/hooks does NOT require any test file change.
 *
 * Usage:
 *   vi.mock("../src/webplayer/hooks", async (importOriginal) =>
 *     makeWebplayerHooksMock(importOriginal, {
 *       useWpOnAir: vi.fn(() => ({ data: undefined, isLoading: false, dataUpdatedAt: 0 })),
 *     }),
 *   );
 */
import { vi } from "vitest";

type ImportOriginalFn = <T = Record<string, unknown>>() => Promise<T>;

export async function makeWebplayerHooksMock(
  importOriginal: ImportOriginalFn,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(actual)) {
    if (typeof val === "function") {
      // React hooks — default to a safe query-result shape
      mocked[key] = vi.fn(() => ({ data: undefined, isLoading: false }));
    } else {
      // Constants and type-only exports (stripped at runtime) — keep as-is
      mocked[key] = val;
    }
  }

  return { ...mocked, ...overrides };
}
