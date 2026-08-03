import { describe, expect, it } from "vitest";
import { guidedMissingLabel, materializeGuidedReplay } from "../src/lib/guidedReplay";

const entries = [
  {
    position: 0,
    rawTitle: "First",
    rawArtist: "Artist",
    recording: {
      mbid: "first",
      title: "First",
      artist: "Artist",
      links: [
        {
          name: "Bandcamp",
          url: "https://bandcamp.com/EmbeddedPlayer/track=123/size=large/",
          kind: "exact" as const,
        },
        {
          name: "YouTube",
          url: "https://www.youtube.com/watch?v=first123",
          kind: "exact" as const,
        },
      ],
    },
    guidedLinks: [],
  },
  {
    position: 1,
    rawTitle: "Second",
    rawArtist: "Artist",
    recording: {
      mbid: "second",
      title: "Second",
      artist: "Artist",
      links: [
        {
          name: "Bandcamp",
          url: "https://bandcamp.com/track/not-an-embed",
          kind: "exact" as const,
        },
        {
          name: "YouTube",
          url: "https://youtu.be/second123",
          kind: "exact" as const,
        },
      ],
    },
    guidedLinks: [],
  },
  {
    position: 2,
    rawTitle: "Missing",
    rawArtist: "Unknown",
    recording: null,
    guidedLinks: [],
  },
  {
    position: 3,
    rawTitle: "Dead",
    rawArtist: "Artist",
    recording: {
      mbid: "dead",
      title: "Dead",
      artist: "Artist",
      links: [
        {
          name: "YouTube",
          url: "https://www.youtube.com/watch?v=dead123",
          kind: "exact" as const,
          deadLink: true,
        } as never,
      ],
    },
    guidedLinks: [],
  },
];

describe("guided Ghost Replay materializer", () => {
  it("prefers official Bandcamp embeds and falls back to YouTube without reordering", () => {
    const guide = materializeGuidedReplay(entries, "bandcamp");

    expect(guide.total).toBe(4);
    expect(guide.available).toBe(2);
    expect(guide.playable.map((entry) => entry.position)).toEqual([0, 1]);
    expect(guide.playable[0]?.source).toMatchObject({
      service: "bandcamp",
      autoAdvance: false,
    });
    expect(guide.playable[1]?.source).toMatchObject({
      service: "youtube",
      autoAdvance: true,
    });
    expect(guide.entries.map((entry) => entry.position)).toEqual([0, 1, 2, 3]);
    expect(guide.missing.map((entry) => entry.missingReason)).toEqual([
      "unresolved",
      "dead-link",
    ]);
  });

  it("only uses YouTube sources when YouTube is selected", () => {
    const guide = materializeGuidedReplay(entries.slice(0, 2), "youtube");

    expect(guide.playable.map((entry) => entry.source?.service)).toEqual([
      "youtube",
      "youtube",
    ]);
    expect(guide.playable.every((entry) => entry.source?.autoAdvance)).toBe(true);
  });

  it("uses a mapped YouTube link when Bandcamp-first has no embeddable Bandcamp source", () => {
    const guide = materializeGuidedReplay(
      [
        {
          position: 0,
          rawTitle: "Mapped fallback",
          rawArtist: "Artist",
          recording: {
            mbid: "mapped-fallback",
            title: "Mapped fallback",
            artist: "Artist",
            links: [],
          },
          guidedLinks: [
            {
              service: "youtube",
              externalId: "mapped123",
              url: "https://www.youtube.com/watch?v=mapped123",
              deadLink: false,
            },
          ],
        },
      ],
      "bandcamp",
    );

    expect(guide.available).toBe(1);
    expect(guide.playable[0]?.source).toMatchObject({
      service: "youtube",
      autoAdvance: true,
    });
  });

  it("keeps unsupported and missing links as honest receipt reasons", () => {
    const guide = materializeGuidedReplay(
      [
        {
          position: 7,
          rawTitle: "Search only",
          rawArtist: "Artist",
          recording: {
            mbid: "search",
            title: "Search only",
            artist: "Artist",
            links: [
              {
                name: "YouTube",
                url: "https://www.youtube.com/results?search_query=search",
                kind: "search" as const,
              },
            ],
          },
        },
      ],
      "youtube",
    );

    expect(guide.available).toBe(0);
    expect(guide.entries[0]?.position).toBe(7);
    expect(guidedMissingLabel(guide.entries[0]!.missingReason!)).toBe(
      "unavailable on this service",
    );
  });
});