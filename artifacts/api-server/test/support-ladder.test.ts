import { describe, expect, it } from "vitest";
import type { RecordingSupportFact } from "@workspace/db";
import {
  bandcampFridayInfo,
  isSafeSupportUrl,
  mapBandcampEmbedSupport,
  mapSupportLadder,
} from "../src/lore/support-ladder.js";

const now = new Date("2026-08-03T12:00:00.000Z");

function fact(
  overrides: Partial<RecordingSupportFact> = {},
): RecordingSupportFact {
  return {
    id: 1,
    recordingMbid: "support-test-recording",
    kind: "artist_direct",
    scope: "release",
    providerId: "catalog-1",
    releaseMbid: "release-1",
    releaseGroupMbid: null,
    url: "https://artist.example/releases/album",
    detail: "Official artist release",
    note: null,
    verification: "exact",
    sourceUrl: "https://artist.example/releases/album",
    fetchedAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("grounded support ladder", () => {
  it("orders verified rows by who gets paid, with Discogs last and explicitly secondhand", () => {
    const result = mapSupportLadder({
      recordingMbid: "support-test-recording",
      now,
      facts: [
        fact({
          id: 3,
          kind: "discogs",
          url: "https://www.discogs.com/release/123",
          sourceUrl: "https://www.discogs.com/release/123",
          detail: "Exact release 123",
        }),
        fact({
          id: 2,
          kind: "label",
          url: "https://label.example/catalog/album",
          detail: "Label catalogue 42",
        }),
        fact(),
      ],
      bandcamp: {
        sourceUrl: "https://artist.bandcamp.com/album/album",
        releaseMbid: "release-1",
        releaseGroupMbid: null,
        providerReleaseId: "album-1",
        providerTrackId: "track-1",
        fetchedAt: now,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      station: {
        name: "Trusted Radio",
        url: "https://radio.example/donate",
        updatedAt: now,
      },
    });

    expect(result.links.map((link) => link.kind)).toEqual([
      "artist",
      "bandcamp",
      "label",
      "station",
      "discogs",
    ]);
    expect(result.links[0]).toMatchObject({
      releaseMbid: "release-1",
      releaseGroupMbid: null,
      providerId: "catalog-1",
      scope: "release",
    });
    expect(result.links.at(-1)).toMatchObject({
      paidTo: "seller",
      note: "Secondhand; artist unpaid.",
      attribution: "Data provided by Discogs",
      sourceUrl: "https://www.discogs.com/release/123",
    });
  });

  it("preserves provider-specific absence and rejects unsafe, stale, or unsupported facts", () => {
    const result = mapSupportLadder({
      recordingMbid: "support-test-recording",
      now,
      facts: [
        fact({ url: "http://artist.example/no-tls" }),
        fact({ id: 2, url: "https://127.0.0.1/metadata" }),
        fact({ id: 3, expiresAt: new Date("2026-08-01T00:00:00.000Z") }),
        fact({
          id: 4,
          kind: "discogs",
          url: "https://www.discogs.com/release/123",
          sourceUrl: null,
        }),
        fact({
          id: 5,
          sourceUrl: "http://unsafe.example/evidence",
        }),
      ],
      bandcamp: {
        sourceUrl: "https://evil.example/album/nope",
        releaseMbid: "release-1",
        releaseGroupMbid: null,
        providerReleaseId: "album-1",
        providerTrackId: null,
        fetchedAt: now,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      station: null,
    });

    expect(result).toMatchObject({
      state: "no_linkable_release",
      emptyMessage: "No linkable release found.",
      links: [],
    });
    expect(isSafeSupportUrl("https://artist.bandcamp.com/album/ok", "bandcamp")).toBe(true);
    expect(isSafeSupportUrl("https://bandcamp.evil.example/album/ok", "bandcamp")).toBe(false);
    expect(isSafeSupportUrl("https://www.discogs.com/release/1", "discogs")).toBe(true);
    expect(isSafeSupportUrl("https://[::1]/support")).toBe(false);
    expect(isSafeSupportUrl("https://[fd00::1]/support")).toBe(false);
  });

  it("keeps release/catalog identity when the durable fact supplies it, without inventing it", () => {
    const release = mapSupportLadder({
      recordingMbid: "support-test-recording",
      now,
      facts: [
        fact({
          scope: "release",
          releaseMbid: "release-1",
          releaseGroupMbid: "group-1",
        }),
        fact({
          id: 2,
          scope: "catalog",
          releaseMbid: null,
          releaseGroupMbid: null,
          providerId: "catalog-door-1",
          detail: "Artist catalogue door",
        }),
      ],
      bandcamp: null,
      station: null,
    });

    expect(release.links).toMatchObject([
      { scope: "release", releaseMbid: "release-1", releaseGroupMbid: "group-1" },
      { scope: "catalog", providerId: "catalog-door-1", releaseMbid: null, releaseGroupMbid: null },
    ]);
  });

  it("only emits a station link when trusted spin provenance supplies a stored support pointer", () => {
    const withoutStation = mapSupportLadder({
      recordingMbid: "support-test-recording",
      now,
      facts: [],
      bandcamp: null,
      station: null,
    });
    const withStation = mapSupportLadder({
      recordingMbid: "support-test-recording",
      now,
      facts: [],
      bandcamp: null,
      station: {
        name: "Trusted Radio",
        url: "https://radio.example/membership",
        updatedAt: now,
      },
    });
    expect(withoutStation.links).toEqual([]);
    expect(withStation.links).toMatchObject([
      { kind: "station", paidTo: "station", tier: 4 },
    ]);
  });

  it("does not reuse stale or provider-scoped missing Bandcamp provenance", () => {
    const base = {
      sourceUrl: "https://artist.bandcamp.com/album/album",
      releaseMbid: "release-1",
      providerReleaseId: "album-1",
      providerTrackId: "track-1",
      fetchedAt: now,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    expect(mapBandcampEmbedSupport({ ...base, outcome: "no_link" }, now)).toBeNull();
    expect(
      mapBandcampEmbedSupport(
        {
          ...base,
          outcome: "embedded",
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        now,
      ),
    ).toBeNull();
    expect(mapBandcampEmbedSupport({ ...base, outcome: "link_out" }, now)).toMatchObject({
      sourceUrl: base.sourceUrl,
      releaseMbid: base.releaseMbid,
    });
  });
});

describe("Bandcamp Friday date rule", () => {
  it("uses the first Friday of the current month, otherwise the next month's first Friday", () => {
    expect(bandcampFridayInfo(new Date("2026-08-07T00:00:00.000Z"))).toEqual({
      eligible: true,
      date: "2026-08-07",
    });
    expect(bandcampFridayInfo(new Date("2026-08-08T00:00:00.000Z"))).toEqual({
      eligible: false,
      date: "2026-09-04",
    });
    expect(bandcampFridayInfo(new Date("2026-12-31T23:59:59.000Z"))).toEqual({
      eligible: false,
      date: "2027-01-01",
    });
  });
});