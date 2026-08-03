import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeAvailableServices,
  GUIDED_SERVICE_OPTIONS,
  guidedMissingLabel,
  materializeGuidedReplay,
  serviceSupportsEmbed,
  type GuidedService,
  type GuidedServiceOption,
} from "../src/lib/guidedReplay";

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
          // A plain Bandcamp page URL (not EmbeddedPlayer) → external-only Bandcamp source.
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
          // Dead Bandcamp link — should appear in the receipt as dead-link.
          name: "Bandcamp",
          url: "https://bandcamp.com/EmbeddedPlayer/track=999/size=large/",
          kind: "exact" as const,
          deadLink: true,
        } as never,
      ],
    },
    guidedLinks: [],
  },
];

describe("guided Ghost Replay materializer", () => {
  it("uses a Bandcamp embed for EmbeddedPlayer URLs and an external link for plain Bandcamp pages; no cross-service fallback", () => {
    const guide = materializeGuidedReplay(entries, "bandcamp");

    expect(guide.total).toBe(4);
    // Both position 0 (embedded) and position 1 (external Bandcamp page) are playable.
    expect(guide.available).toBe(2);
    expect(guide.playable.map((entry) => entry.position)).toEqual([0, 1]);

    // Position 0: EmbeddedPlayer URL → iframe embed.
    expect(guide.playable[0]?.source).toMatchObject({
      service: "bandcamp",
      autoAdvance: false,
      externalOnly: false,
    });

    // Position 1: plain Bandcamp page URL → external-open only (still Bandcamp, not YouTube).
    expect(guide.playable[1]?.source).toMatchObject({
      service: "bandcamp",
      autoAdvance: false,
      externalOnly: true,
    });

    // Position order is preserved in entries.
    expect(guide.entries.map((entry) => entry.position)).toEqual([0, 1, 2, 3]);

    // Receipt: position 2 is unresolved, position 3 is a dead Bandcamp link.
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

  it("does not cross-serve: a YouTube-only guidedLink is unavailable when Bandcamp is selected", () => {
    const ytOnlyEntry = [
      {
        position: 0,
        rawTitle: "YouTube only",
        rawArtist: "Artist",
        recording: {
          mbid: "yt-only",
          title: "YouTube only",
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
    ];

    // Bandcamp selected → no Bandcamp link → unavailable.
    const bandcampGuide = materializeGuidedReplay(ytOnlyEntry, "bandcamp");
    expect(bandcampGuide.available).toBe(0);
    expect(bandcampGuide.entries[0]?.missingReason).toBe("unavailable");

    // YouTube selected → YouTube link resolves to an embed.
    const youtubeGuide = materializeGuidedReplay(ytOnlyEntry, "youtube");
    expect(youtubeGuide.available).toBe(1);
    expect(youtubeGuide.playable[0]?.source).toMatchObject({
      service: "youtube",
      autoAdvance: true,
      externalOnly: false,
    });
  });

  it("resolves snake_case guidedLink service keys (DB format) and a Bandcamp mapping correctly", () => {
    const snakeCaseEntries = [
      {
        position: 0,
        rawTitle: "Apple Music via DB key",
        rawArtist: "Artist",
        recording: { mbid: "am-snake", title: "Apple Music via DB key", artist: "Artist", links: [] },
        guidedLinks: [
          { service: "apple_music", externalId: null, url: "https://music.apple.com/us/album/foo/123", deadLink: false },
        ],
      },
      {
        position: 1,
        rawTitle: "Bandcamp mapped track",
        rawArtist: "Artist",
        recording: { mbid: "bc-mapped", title: "Bandcamp mapped track", artist: "Artist", links: [] },
        guidedLinks: [
          { service: "bandcamp", externalId: null, url: "https://artistname.bandcamp.com/track/foo", deadLink: false },
        ],
      },
      {
        position: 2,
        rawTitle: "YouTube Music via DB key",
        rawArtist: "Artist",
        recording: { mbid: "ytm-snake", title: "YouTube Music via DB key", artist: "Artist", links: [] },
        guidedLinks: [
          { service: "youtube_music", externalId: null, url: "https://music.youtube.com/watch?v=abc123", deadLink: false },
        ],
      },
    ];

    // apple_music DB key resolves correctly for appleMusic service.
    const amGuide = materializeGuidedReplay([snakeCaseEntries[0]!], "appleMusic");
    expect(amGuide.available).toBe(1);
    expect(amGuide.playable[0]?.source).toMatchObject({ service: "appleMusic", externalOnly: true });

    // bandcamp DB key resolves as external-open for a non-EmbeddedPlayer URL.
    const bcGuide = materializeGuidedReplay([snakeCaseEntries[1]!], "bandcamp");
    expect(bcGuide.available).toBe(1);
    expect(bcGuide.playable[0]?.source).toMatchObject({ service: "bandcamp", externalOnly: true });

    // youtube_music DB key resolves correctly for youtubeMusic service.
    const ytmGuide = materializeGuidedReplay([snakeCaseEntries[2]!], "youtubeMusic");
    expect(ytmGuide.available).toBe(1);
    expect(ytmGuide.playable[0]?.source).toMatchObject({ service: "youtubeMusic", externalOnly: true });

    // youtube_music is NOT matched by the youtube service filter.
    const ytGuide = materializeGuidedReplay([snakeCaseEntries[2]!], "youtube");
    expect(ytGuide.available).toBe(0);
  });

  it("rejects unsafe or off-service URLs before they can reach the link renderer", () => {
    const unsafeEntries = [
      {
        position: 0,
        rawTitle: "XSS attempt",
        rawArtist: "Artist",
        recording: {
          mbid: "xss",
          title: "XSS attempt",
          artist: "Artist",
          links: [{ name: "Bandcamp", url: "javascript:alert(1)", kind: "exact" as const }],
        },
        guidedLinks: [],
      },
      {
        position: 1,
        rawTitle: "HTTP not HTTPS",
        rawArtist: "Artist",
        recording: {
          mbid: "http-bc",
          title: "HTTP not HTTPS",
          artist: "Artist",
          links: [{ name: "Bandcamp", url: "http://bandcamp.com/track/foo", kind: "exact" as const }],
        },
        guidedLinks: [],
      },
      {
        position: 2,
        rawTitle: "Wrong host for Apple Music",
        rawArtist: "Artist",
        recording: { mbid: "wrong-host", title: "Wrong host", artist: "Artist", links: [] },
        guidedLinks: [
          { service: "appleMusic", externalId: null, url: "https://evil.example.com/track/123", deadLink: false },
        ],
      },
      {
        position: 3,
        rawTitle: "Valid Apple Music",
        rawArtist: "Artist",
        recording: { mbid: "valid-am", title: "Valid Apple Music", artist: "Artist", links: [] },
        guidedLinks: [
          { service: "appleMusic", externalId: null, url: "https://music.apple.com/us/album/foo/123", deadLink: false },
        ],
      },
    ];

    const bandcampGuide = materializeGuidedReplay(unsafeEntries.slice(0, 2), "bandcamp");
    expect(bandcampGuide.available).toBe(0);
    expect(bandcampGuide.entries[0]?.missingReason).toBe("unavailable");
    expect(bandcampGuide.entries[1]?.missingReason).toBe("unavailable");

    const amGuide = materializeGuidedReplay(unsafeEntries.slice(2), "appleMusic");
    expect(amGuide.available).toBe(1);
    expect(amGuide.entries[0]?.missingReason).toBe("unavailable"); // wrong host
    expect(amGuide.playable[0]?.source?.url).toBe("https://music.apple.com/us/album/foo/123");
    expect(amGuide.playable[0]?.source?.externalOnly).toBe(true);
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

  it("unknown service key: resolves a valid HTTPS link via the generic path", () => {
    const unknownServiceEntries = [
      {
        position: 0,
        rawTitle: "Track On Tidal HiFi",
        rawArtist: "Artist",
        recording: {
          mbid: "tidal-hifi-track",
          title: "Track On Tidal HiFi",
          artist: "Artist",
          links: [],
        },
        guidedLinks: [
          {
            service: "tidal_hifi",
            externalId: null,
            url: "https://tidal.com/browse/track/12345",
            deadLink: false,
          },
        ],
      },
    ];

    const guide = materializeGuidedReplay(unknownServiceEntries, "tidal_hifi");
    expect(guide.service).toBe("tidal_hifi");
    expect(guide.available).toBe(1);
    expect(guide.playable[0]?.source).toMatchObject({
      service: "tidal_hifi",
      url: "https://tidal.com/browse/track/12345",
      embedUrl: null,
      externalOnly: true,
      autoAdvance: false,
    });
  });

  it("unknown service key: rejects an HTTP link (HTTPS-only guard)", () => {
    const httpEntries = [
      {
        position: 0,
        rawTitle: "Insecure Track",
        rawArtist: "Artist",
        recording: {
          mbid: "insecure",
          title: "Insecure Track",
          artist: "Artist",
          links: [],
        },
        guidedLinks: [
          {
            service: "tidal_hifi",
            externalId: null,
            url: "http://tidal.com/browse/track/99",
            deadLink: false,
          },
        ],
      },
    ];

    const guide = materializeGuidedReplay(httpEntries, "tidal_hifi");
    expect(guide.available).toBe(0);
    expect(guide.entries[0]?.missingReason).toBe("unavailable");
  });

  it("unknown service key: dead-link flag suppresses the source and sets reason dead-link", () => {
    const deadEntries = [
      {
        position: 0,
        rawTitle: "Gone",
        rawArtist: "Artist",
        recording: {
          mbid: "gone",
          title: "Gone",
          artist: "Artist",
          links: [],
        },
        guidedLinks: [
          {
            service: "tidal_hifi",
            externalId: null,
            url: "https://tidal.com/browse/track/dead",
            deadLink: true,
          },
        ],
      },
    ];

    const guide = materializeGuidedReplay(deadEntries, "tidal_hifi");
    expect(guide.available).toBe(0);
    expect(guide.entries[0]?.missingReason).toBe("dead-link");
  });

  it("unknown service key: case-insensitive match — 'Tidal_HiFi' matches service 'tidal_hifi'", () => {
    const mixedCaseEntries = [
      {
        position: 0,
        rawTitle: "Case Mismatch",
        rawArtist: "Artist",
        recording: {
          mbid: "case-mismatch",
          title: "Case Mismatch",
          artist: "Artist",
          links: [],
        },
        guidedLinks: [
          {
            service: "Tidal_HiFi",
            externalId: null,
            url: "https://tidal.com/browse/track/777",
            deadLink: false,
          },
        ],
      },
    ];

    const guide = materializeGuidedReplay(mixedCaseEntries, "tidal_hifi");
    expect(guide.available).toBe(1);
    expect(guide.playable[0]?.source?.service).toBe("tidal_hifi");
  });
});

describe("computeAvailableServices", () => {
  it("always includes all known services regardless of guidedLinks", () => {
    const result = computeAvailableServices([]);
    const knownServices = GUIDED_SERVICE_OPTIONS.map((o) => o.service);
    for (const svc of knownServices) {
      expect(result.some((r) => r.service === svc)).toBe(true);
    }
    expect(result.length).toBe(GUIDED_SERVICE_OPTIONS.length);
  });

  it("appends an unknown service key as a title-cased tab", () => {
    const entries = [
      {
        guidedLinks: [
          { service: "tidal_hifi", deadLink: false },
        ],
      },
    ];

    const result = computeAvailableServices(entries);
    const extra = result.find((r) => r.service === "tidal_hifi");
    expect(extra).toBeDefined();
    expect(extra?.label).toBe("Tidal Hifi");
    // Total = known services + 1 unknown
    expect(result.length).toBe(GUIDED_SERVICE_OPTIONS.length + 1);
  });

  it("appends multiple unknown service keys, sorted alphabetically", () => {
    const entries = [
      {
        guidedLinks: [
          { service: "zvuk", deadLink: false },
          { service: "anghami", deadLink: false },
        ],
      },
    ];

    const result = computeAvailableServices(entries);
    const extras = result.slice(GUIDED_SERVICE_OPTIONS.length);
    expect(extras.map((r) => r.service)).toEqual(["anghami", "zvuk"]);
    expect(extras[0]?.label).toBe("Anghami");
    expect(extras[1]?.label).toBe("Zvuk");
  });

  it("deduplicates repeated unknown service keys across entries", () => {
    const entries = [
      { guidedLinks: [{ service: "tidal_hifi", deadLink: false }] },
      { guidedLinks: [{ service: "tidal_hifi", deadLink: false }] },
    ];

    const result = computeAvailableServices(entries);
    const tidalHifiTabs = result.filter((r) => r.service === "tidal_hifi");
    expect(tidalHifiTabs.length).toBe(1);
  });

  it("suppresses an unknown service tab when ALL its links are dead", () => {
    const entries = [
      {
        guidedLinks: [
          { service: "tidal_hifi", deadLink: true },
        ],
      },
    ];

    const result = computeAvailableServices(entries);
    expect(result.some((r) => r.service === "tidal_hifi")).toBe(false);
    expect(result.length).toBe(GUIDED_SERVICE_OPTIONS.length);
  });

  it("still shows an unknown service when at least one link is live, even if others are dead", () => {
    const entries = [
      {
        guidedLinks: [
          { service: "tidal_hifi", deadLink: true },
          { service: "tidal_hifi", deadLink: false },
        ],
      },
    ];

    const result = computeAvailableServices(entries);
    expect(result.some((r) => r.service === "tidal_hifi")).toBe(true);
  });

  it("does not add a duplicate tab for known services present in guidedLinks", () => {
    const entries = [
      {
        guidedLinks: [
          { service: "youtube", deadLink: false },
          { service: "bandcamp", deadLink: false },
        ],
      },
    ];

    const result = computeAvailableServices(entries);
    const youtubeTabs = result.filter((r) => r.service === "youtube");
    const bandcampTabs = result.filter((r) => r.service === "bandcamp");
    expect(youtubeTabs.length).toBe(1);
    expect(bandcampTabs.length).toBe(1);
    expect(result.length).toBe(GUIDED_SERVICE_OPTIONS.length);
  });

  it("title-cases multi-word snake_case service keys correctly", () => {
    const entries = [
      { guidedLinks: [{ service: "amazon_music_unlimited", deadLink: false }] },
    ];

    const result = computeAvailableServices(entries);
    const extra = result.find((r) => r.service === "amazon_music_unlimited");
    expect(extra?.label).toBe("Amazon Music Unlimited");
  });
});

// ---------------------------------------------------------------------------
// Embed contract: a new service added to GUIDED_SERVICE_OPTIONS with an
// embedUrlBuilder automatically produces iframe-capable sources without any
// other code change.
// ---------------------------------------------------------------------------
describe("new embed service — zero-change contract", () => {
  const SYNTHETIC_KEY = "acmemusic" as GuidedService;

  const syntheticOption: GuidedServiceOption = {
    service: SYNTHETIC_KEY,
    label: "Acme Music",
    embedUrlBuilder: (url) =>
      /^https:\/\/acme\.example\/embed\/\d+$/.test(url) ? url : null,
  };

  beforeEach(() => {
    (GUIDED_SERVICE_OPTIONS as GuidedServiceOption[]).push(syntheticOption);
  });

  afterEach(() => {
    const idx = (GUIDED_SERVICE_OPTIONS as GuidedServiceOption[]).indexOf(syntheticOption);
    if (idx >= 0) (GUIDED_SERVICE_OPTIONS as GuidedServiceOption[]).splice(idx, 1);
  });

  it("serviceSupportsEmbed returns true for a service whose entry carries an embedUrlBuilder", () => {
    expect(serviceSupportsEmbed("acmemusic")).toBe(true);
  });

  it("serviceSupportsEmbed returns false for a known service without an embedUrlBuilder", () => {
    expect(serviceSupportsEmbed("appleMusic")).toBe(false);
    expect(serviceSupportsEmbed("tidal")).toBe(false);
  });

  it("materializeGuidedReplay produces externalOnly:false and a non-null embedUrl for an embeddable URL", () => {
    const testEntries = [
      {
        position: 0,
        rawTitle: "Acme Track",
        rawArtist: "Acme Artist",
        recording: {
          mbid: "acme-1",
          title: "Acme Track",
          artist: "Acme Artist",
          links: [
            {
              name: "acmemusic",
              url: "https://acme.example/embed/42",
              kind: "exact" as const,
            },
          ],
        },
        guidedLinks: [],
      },
    ];

    const guide = materializeGuidedReplay(testEntries, "acmemusic");

    expect(guide.available).toBe(1);
    const source = guide.playable[0]?.source;
    expect(source?.externalOnly).toBe(false);
    expect(source?.embedUrl).not.toBeNull();
    expect(source?.embedUrl).toBe("https://acme.example/embed/42");
  });

  it("materializeGuidedReplay falls back to externalOnly:true when the URL is not in embeddable shape", () => {
    const testEntries = [
      {
        position: 0,
        rawTitle: "Acme Track",
        rawArtist: "Acme Artist",
        recording: {
          mbid: "acme-2",
          title: "Acme Track",
          artist: "Acme Artist",
          links: [
            {
              // plain page URL — not in the embed pattern
              name: "acmemusic",
              url: "https://acme.example/track/42",
              kind: "exact" as const,
            },
          ],
        },
        guidedLinks: [],
      },
    ];

    const guide = materializeGuidedReplay(testEntries, "acmemusic");

    expect(guide.available).toBe(1);
    const source = guide.playable[0]?.source;
    expect(source?.externalOnly).toBe(true);
    expect(source?.embedUrl).toBeNull();
  });
});
