/**
 * Shared factory for vi.mock("@workspace/api-client-react", ...) blocks.
 *
 * Uses `importOriginal` so:
 *  - Classes (ApiError) and schema constants are kept from the real module.
 *  - Every `use*` React Query hook is stubbed with vi.fn().
 *  - Every plain async function (getRecording, spotifyPlay, …) is vi.fn().
 *  - A new export added to the package does NOT require any test file change.
 *
 * Usage:
 *   vi.mock("@workspace/api-client-react", async (importOriginal) =>
 *     makeApiClientMock(importOriginal, {
 *       spotifyPlay: vi.fn(async () => ({ trackUri: "spotify:track:abc" })),
 *     }),
 *   );
 */
import { vi } from "vitest";

type ImportOriginalFn = <T = Record<string, unknown>>() => Promise<T>;

export async function makeApiClientMock(
  importOriginal: ImportOriginalFn,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(actual)) {
    if (typeof val === "function") {
      // Keep classes (PascalCase: ApiError, etc.) from the real module
      if (/^[A-Z]/.test(key)) {
        mocked[key] = val;
      } else if (key.startsWith("use")) {
        // React Query hooks — default to a safe query-result shape
        mocked[key] = vi.fn(() => ({ data: undefined, isLoading: false }));
      } else {
        // Plain async fetchers: getRecording, spotifyPlay, getGetXQueryKey, …
        mocked[key] = vi.fn();
      }
    } else {
      // Constants, type-only exports (stripped at runtime) — keep as-is
      mocked[key] = val;
    }
  }

  return { ...mocked, ...overrides };
}
