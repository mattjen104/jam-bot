import { describe, expect, it } from "vitest";
import type { Station } from "@workspace/db";
import { playbackCandidatesForStation } from "../../src/lore/playback-candidates.js";

function station(overrides: Partial<Station>): Station {
  return {
    slug: "wmfo", streamUrl: "http://radio.example/live", streamFormat: "mp3",
    healthFailures: 0, lastAliveAt: new Date(), nowPlayingConfig: null,
    ...overrides,
  } as Station;
}

describe("playbackCandidatesForStation", () => {
  it("puts the sanctioned relay ahead of an HTTP primary", () => {
    const candidates = playbackCandidatesForStation(station({}));
    expect(candidates.map((candidate) => candidate.role)).toEqual(["relay"]);
    expect(candidates[0]!.url).toBe("/api/stations/wmfo/relay");
  });

  it("omits unsafe, secret-bearing, and duplicate mounts", () => {
    const candidates = playbackCandidatesForStation(station({
      nowPlayingConfig: { mounts: [
        { url: "https://radio.example/live" },
        { url: "javascript:alert(1)" },
        { url: "https://user:secret@radio.example/stream" },
        { url: "https://radio.example/stream?token=secret" },
        { url: "https://radio.example/alt.m3u8", format: "hls" },
      ] },
    }));
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      "/api/stations/wmfo/relay", "https://radio.example/live",
      "https://radio.example/alt.m3u8",
    ]);
    expect(candidates.at(-1)).toMatchObject({ role: "alternate", format: "hls" });
  });

  it("keeps a query-bearing primary on the legacy contract only", () => {
    const candidates = playbackCandidatesForStation(station({
      slug: "query-stream",
      streamUrl: "https://cdn.example/live?player=lore",
    }));
    expect(candidates).toEqual([]);
  });

  it("does not advertise raw HTTP when no relay is sanctioned", () => {
    expect(playbackCandidatesForStation(station({
      slug: "not-relay-allowlisted",
    }))).toEqual([]);
  });
});