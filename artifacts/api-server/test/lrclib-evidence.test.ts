import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLrclibEvidence,
  shouldRetryLyricsEvidence,
} from "../src/lore/lrclib.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchLrclibEvidence", () => {
  it("preserves an explicit instrumental response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ instrumental: true })));
    await expect(
      fetchLrclibEvidence("Track", "Artist", null, 180_000),
    ).resolves.toMatchObject({
      status: "instrumental",
      lines: [],
      synced: false,
    });
  });

  it("keeps a genuine 404 distinct from instrumental", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 404)));
    await expect(
      fetchLrclibEvidence("Track", "Artist", null, null),
    ).resolves.toMatchObject({
      status: "no_result",
      lines: [],
    });
  });

  it("keeps provider failures transient instead of caching them as misses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 503)));
    await expect(
      fetchLrclibEvidence("Track", "Artist", null, null),
    ).resolves.toMatchObject({
      status: "transient_failure",
      error: "HTTP 503",
    });
  });

  it("classifies synced and plain lyric hits as lyrics_found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      syncedLyrics: "[00:01.00]First line",
    })));
    await expect(
      fetchLrclibEvidence("Track", "Artist", null, null),
    ).resolves.toMatchObject({
      status: "lyrics_found",
      synced: true,
      lines: [{ offsetMs: 1_000, text: "First line" }],
    });
  });
});

describe("shouldRetryLyricsEvidence", () => {
  const now = Date.UTC(2026, 8, 3, 16);

  it("retries only unattempted and cooled-down transient outcomes", () => {
    expect(shouldRetryLyricsEvidence("not_checked", null, now)).toBe(true);
    expect(shouldRetryLyricsEvidence(
      "transient_failure",
      new Date(now - 14 * 60_000),
      now,
    )).toBe(false);
    expect(shouldRetryLyricsEvidence(
      "transient_failure",
      new Date(now - 15 * 60_000),
      now,
    )).toBe(true);
  });

  it("never repeats definitive outcomes merely because they are old", () => {
    const old = new Date(0);
    for (const status of ["lyrics_found", "instrumental", "no_result"] as const) {
      expect(shouldRetryLyricsEvidence(status, old, now)).toBe(false);
    }
  });
});