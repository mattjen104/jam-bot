import { describe, expect, it } from "vitest";
import { materializeGuidedReplayQueue } from "../src/lore/guided-replay-queue.js";

const manifest = {
  replayId: 42,
  entries: [
    {
      position: 0,
      spinId: 900,
      playedAt: "2026-08-03T10:00:00.000Z",
      source: "station-feed",
      citation: "https://example.test/archive",
      rawArtist: "Mapped Artist",
      rawTitle: "Mapped Song",
      recording: {
        mbid: "mapped-mbid",
        title: "Mapped Song",
        artist: "Mapped Artist",
        links: [
          {
            name: "Spotify",
            url: "https://open.spotify.com/track/1234567890123456789012",
            kind: "exact" as const,
          },
        ],
      },
    },
    {
      position: 1,
      spinId: 901,
      playedAt: "2026-08-03T10:03:00.000Z",
      source: null,
      citation: null,
      rawArtist: "Missing Artist",
      rawTitle: "Missing Song",
      recording: null,
    },
    {
      position: 2,
      spinId: 902,
      playedAt: "2026-08-03T10:06:00.000Z",
      source: "station-feed",
      citation: null,
      rawArtist: "Dead Artist",
      rawTitle: "Dead Song",
      recording: {
        mbid: "dead-mbid",
        title: "Dead Song",
        artist: "Dead Artist",
      },
    },
  ],
} as const;

describe("materializeGuidedReplayQueue", () => {
  it("preserves manifest order and positions, selects Spotify native links, and keeps gaps explicit", () => {
    const queue = materializeGuidedReplayQueue({
      manifest,
      service: "spotify",
      maps: [
        {
          recordingMbid: "mapped-mbid",
          service: "spotify",
          externalId: "1234567890123456789012",
          url: "https://open.spotify.com/track/1234567890123456789012",
          confidence: "exact",
          deadLink: false,
        },
      ],
    });

    expect(queue.entries.map((entry) => entry.position)).toEqual([0, 1, 2]);
    expect(queue.entries.map((entry) => entry.spinId)).toEqual([900, 901, 902]);
    expect(queue.entries[0]?.target).toEqual({
      kind: "native",
      url: "spotify:track:1234567890123456789012",
      externalId: "1234567890123456789012",
      fallbackUrl: "https://open.spotify.com/track/1234567890123456789012",
    });
    expect(queue.entries[1]?.missingReason).toBe("not_mapped");
    expect(queue.entries[2]?.missingReason).toBe("not_mapped");
    expect(queue.coverage).toEqual({ total: 3, available: 1, missing: 2 });
    expect(queue.entries[0]?.provenance).toEqual({
      source: "station-feed",
      citation: "https://example.test/archive",
    });
  });

  it("uses safe canonical web URLs when a service has no native protocol", () => {
    const queue = materializeGuidedReplayQueue({
      manifest: {
        replayId: manifest.replayId,
        entries: [manifest.entries[0]],
      },
      service: "youtube_music",
      maps: [
        {
          recordingMbid: "mapped-mbid",
          service: "youtube_music",
          externalId: "video-1",
          url: "https://music.youtube.com/watch?v=video-1",
          confidence: "exact",
          deadLink: false,
        },
      ],
    });

    expect(queue.entries[0]?.target).toEqual({
      kind: "web",
      url: "https://music.youtube.com/watch?v=video-1",
      externalId: "video-1",
    });
  });

  it("does not open dead, non-exact, or unsafe mappings", () => {
    const base = manifest.entries[0];
    const queue = materializeGuidedReplayQueue({
      manifest: {
        replayId: manifest.replayId,
        entries: [base, { ...base, position: 1, spinId: 903 }],
      },
      service: "amazon_music",
      maps: [
        {
          recordingMbid: "mapped-mbid",
          service: "amazon_music",
          externalId: "dead",
          url: "https://music.amazon.com/albums/dead",
          confidence: "exact",
          deadLink: true,
        },
        {
          recordingMbid: "mapped-mbid",
          service: "amazon_music",
          externalId: "search",
          url: "javascript:alert(1)",
          confidence: "search",
          deadLink: false,
        },
      ],
    });

    expect(queue.entries[0]?.missingReason).toBe("dead_mapping");
    // The materializer uses one stable map per recording/service; a lower
    // quality duplicate cannot bypass the dead exact mapping.
    expect(queue.entries[1]?.missingReason).toBe("dead_mapping");
  });
});