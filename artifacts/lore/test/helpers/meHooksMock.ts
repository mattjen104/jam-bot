/**
 * Shared factory for vi.mock("../src/lib/meHooks", ...) blocks.
 *
 * Uses `importOriginal` so:
 *  - Query-key constants (ME_*_KEY) always come from the real module.
 *  - Every `use*` hook is automatically stubbed with vi.fn().
 *  - Every async helper (post*, patch*, delete*, start*) is vi.fn().
 *  - A new export added to meHooks does NOT require any test file change.
 *
 * Usage:
 *   vi.mock("../src/lib/meHooks", async (importOriginal) =>
 *     makeMeHooksMock(importOriginal, {
 *       useLatestImportJob: vi.fn(() => ({ data: null })),
 *     }),
 *   );
 */
import { vi } from "vitest";

type ImportOriginalFn = <T = Record<string, unknown>>() => Promise<T>;

export async function makeMeHooksMock(
  importOriginal: ImportOriginalFn,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(actual)) {
    if (typeof val === "function") {
      if (key.startsWith("use")) {
        // React hooks — default to a safe query-result shape
        mocked[key] = vi.fn(() => ({ data: undefined, isLoading: false }));
      } else {
        // Async helpers: postStartImport, patchPreferences, postListen, …
        mocked[key] = vi.fn();
      }
    } else {
      // Constants: ME_*_KEY arrays, interfaces (stripped at runtime) — keep as-is
      mocked[key] = val;
    }
  }

  // Warn about override keys that don't exist in the real module — these are
  // likely typos or stale references that would silently have no effect.
  for (const key of Object.keys(overrides)) {
    if (!(key in actual)) {
      console.warn(
        `[makeMeHooksMock] Override key "${key}" is not exported by the real meHooks module. ` +
          `This stub will have no effect — check for a typo or stale override.`,
      );
    }
  }

  return { ...mocked, ...overrides };
}
