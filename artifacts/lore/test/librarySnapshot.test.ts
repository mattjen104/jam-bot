// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readLibrarySnapshot,
  writeLibrarySnapshot,
} from "../src/lib/librarySnapshot";

const KEY = [100, "", "added", ""] as const;

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("library first-page snapshot", () => {
  it("round-trips a valid first page under the exact query key", () => {
    const page = {
      items: [{ mbid: "one" }],
      nextCursor: "next",
      total: 1900,
    };
    writeLibrarySnapshot(KEY, page);

    expect(readLibrarySnapshot(KEY)).toEqual(page);
    expect(readLibrarySnapshot([100, "", "artist", ""])).toBeUndefined();
  });

  it("rejects malformed storage without breaking the caller", () => {
    localStorage.setItem(
      `lore:library:first-page:v1:${JSON.stringify(KEY)}`,
      JSON.stringify({ savedAt: Date.now(), page: { items: "not-an-array" } }),
    );
    expect(readLibrarySnapshot(KEY)).toBeUndefined();
  });

  it("expires snapshots after seven days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    writeLibrarySnapshot(KEY, { items: [], nextCursor: null });
    vi.setSystemTime(new Date("2026-09-09T00:00:01Z"));

    expect(readLibrarySnapshot(KEY)).toBeUndefined();
  });
});