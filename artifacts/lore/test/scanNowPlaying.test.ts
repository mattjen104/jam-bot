/**
 * buildScanNowPlaying — the Scan lens's freshness gate.
 *
 * The now-playing endpoint returns the all-time latest spin per station, so
 * an off-air station's hours-old last spin must never be rotated into a Scan
 * category button as "live". Only observations inside the 60-minute
 * live-pulse window (the same gate liveBySlug applies) may appear.
 *
 * Covers:
 *  1. A fresh REST observation is included, with its SOURCE playedAt
 *     preserved (not replaced by a ~now display stamp).
 *  2. A stale REST observation (older than the window) is excluded.
 *  3. An unparseable/missing playedAt is excluded — freshness can't be
 *     vouched for.
 *  4. A fresh SSE override is included even with no REST entry, and wins
 *     over the REST baseline for the same slug.
 *  5. A stale SSE override (lingering after the station went dark) is
 *     excluded.
 */
import { describe, expect, it } from "vitest";

import {
  buildScanNowPlaying,
  LIVE_PULSE_WINDOW_MS,
  type DialSpin,
} from "../src/hooks/useDialData";

const NOW = new Date("2026-08-19T12:00:00.000Z").getTime();

function spin(artist: string, playedAt: string): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "Track",
    artist,
    playedAt,
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    releaseYear: null,
    ageTier: null,
  };
}

const FRESH_ISO = new Date(NOW - 5 * 60 * 1000).toISOString(); // 5 min ago
const STALE_ISO = new Date(NOW - 2 * 60 * 60 * 1000).toISOString(); // 2 h ago

describe("buildScanNowPlaying", () => {
  it("includes a fresh REST observation and preserves its source playedAt", () => {
    const rest = new Map([["kexp", spin("The Smile", FRESH_ISO)]]);
    const result = buildScanNowPlaying(rest, new Map(), NOW);
    expect(result.get("kexp")?.playedAt).toBe(FRESH_ISO);
  });

  it("excludes a stale REST observation (off-air station's last spin)", () => {
    const rest = new Map([
      ["kexp", spin("The Smile", FRESH_ISO)],
      ["dark-fm", spin("Old Track", STALE_ISO)],
    ]);
    const result = buildScanNowPlaying(rest, new Map(), NOW);
    expect(result.has("kexp")).toBe(true);
    expect(result.has("dark-fm")).toBe(false);
  });

  it("excludes entries whose playedAt cannot be vouched for", () => {
    const rest = new Map([
      ["no-date", spin("Mystery", "")],
      ["bad-date", spin("Mystery", "not-a-date")],
    ]);
    const result = buildScanNowPlaying(rest, new Map(), NOW);
    expect(result.size).toBe(0);
  });

  it("includes a fresh SSE override even with no REST entry, and lets SSE win", () => {
    const rest = new Map([["kexp", spin("REST Artist", FRESH_ISO)]]);
    const sse = new Map([
      ["kexp", spin("SSE Artist", FRESH_ISO)],
      ["nts", spin("SSE Only", FRESH_ISO)],
    ]);
    const result = buildScanNowPlaying(rest, sse, NOW);
    expect(result.get("kexp")?.artist).toBe("SSE Artist");
    expect(result.get("nts")?.artist).toBe("SSE Only");
  });

  it("excludes a stale SSE override but keeps a fresh REST baseline", () => {
    const rest = new Map([["kexp", spin("REST Artist", FRESH_ISO)]]);
    const sse = new Map([["kexp", spin("SSE Artist", STALE_ISO)]]);
    const result = buildScanNowPlaying(rest, sse, NOW);
    // The stale SSE row is dropped; the fresh REST baseline survives.
    expect(result.get("kexp")?.artist).toBe("REST Artist");
  });

  it("treats exactly-window-old observations as fresh (inclusive boundary)", () => {
    const atBoundary = new Date(NOW - LIVE_PULSE_WINDOW_MS).toISOString();
    const rest = new Map([["kexp", spin("The Smile", atBoundary)]]);
    expect(buildScanNowPlaying(rest, new Map(), NOW).has("kexp")).toBe(true);
  });
});
