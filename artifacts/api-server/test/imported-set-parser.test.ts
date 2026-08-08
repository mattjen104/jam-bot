import { describe, expect, it } from "vitest";
import {
  IMPORTED_SET_MAX_BYTES,
  IMPORTED_SET_MAX_TRACKS,
  parseImportedSet,
} from "../src/lore/imported-set-parser.js";
import {
  buildJspf,
  buildXspf,
  type ReplayExportModel,
} from "../src/lore/replay-export.js";
import type { ReplayManifest } from "../src/lore/replay.js";

const UUID_A = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------------------
// Plain third-party files (no Lore metadata) — first-class input
// ---------------------------------------------------------------------------

describe("parseImportedSet — third-party files", () => {
  it("parses a title/creator-only JSPF playlist", () => {
    const jspf = JSON.stringify({
      playlist: {
        title: "Road Trip",
        track: [
          { title: "Go Your Own Way", creator: "Fleetwood Mac" },
          { title: "Dreams", creator: "Fleetwood Mac", duration: 257000 },
        ],
      },
    });
    const result = parseImportedSet(jspf, "roadtrip.jspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.format).toBe("jspf");
    expect(result.manifest.title).toBe("Road Trip");
    expect(result.manifest.entries).toHaveLength(2);
    expect(result.manifest.entries[0]).toMatchObject({
      position: 0,
      title: "Go Your Own Way",
      creator: "Fleetwood Mac",
      claimedMbid: null,
      claimedIsrc: null,
      claimedMbidFromLore: false,
    });
    expect(result.manifest.entries[1]!.durationMs).toBe(257000);
  });

  it("parses a plain standards-compliant XSPF playlist (VLC-style)", () => {
    const xspf = `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>Mix</title>
  <trackList>
    <track><title>Song One</title><creator>Some Band</creator><duration>180000</duration></track>
    <track><title>Song Two</title><creator>Other Band</creator><album>That Album</album></track>
  </trackList>
</playlist>`;
    const result = parseImportedSet(xspf, "mix.xspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.format).toBe("xspf");
    expect(result.manifest.title).toBe("Mix");
    expect(result.manifest.entries).toHaveLength(2);
    expect(result.manifest.entries[0]!.durationMs).toBe(180000);
    expect(result.manifest.entries[1]!.album).toBe("That Album");
  });

  it("reads standard MusicBrainz and ISRC identifiers from third-party files", () => {
    const jspf = JSON.stringify({
      playlist: {
        track: [
          {
            title: "Identified",
            creator: "Someone",
            identifier: [
              `https://musicbrainz.org/recording/${UUID_A}`,
              "isrc:USABC1234567",
            ],
          },
        ],
      },
    });
    const result = parseImportedSet(jspf, "ids.jspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.manifest.entries[0]!;
    expect(entry.claimedMbid).toBe(UUID_A);
    expect(entry.claimedMbidFromLore).toBe(false);
    expect(entry.claimedIsrc).toBe("USABC1234567");
  });

  it("prefers Lore extension MBID metadata over standard identifiers", () => {
    const uuidB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const jspf = JSON.stringify({
      playlist: {
        track: [
          {
            title: "T",
            creator: "C",
            identifier: [`https://musicbrainz.org/recording/${UUID_A}`],
            meta: [{ rel: "lore:recording_mbid", content: uuidB }],
          },
        ],
      },
    });
    const result = parseImportedSet(jspf, "x.jspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.entries[0]!.claimedMbid).toBe(uuidB);
    expect(result.manifest.entries[0]!.claimedMbidFromLore).toBe(true);
  });

  it("keeps entries with no usable facts as honest empty slots", () => {
    const jspf = JSON.stringify({ playlist: { track: [{}, { title: "Real" }] } });
    const result = parseImportedSet(jspf, "gaps.jspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.entries[0]).toMatchObject({
      title: null,
      creator: null,
      claimedMbid: null,
      claimedIsrc: null,
    });
    expect(result.manifest.entries[1]!.title).toBe("Real");
  });

  it("tolerates foreign extensions and unknown fields", () => {
    const xspf = `<?xml version="1.0"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <trackList>
    <track>
      <title>Weird</title><creator>Band</creator>
      <extension application="https://other.tool/ns"><foo:bar>zap</foo:bar></extension>
      <somethingUnknown>ignored</somethingUnknown>
    </track>
  </trackList>
</playlist>`;
    const result = parseImportedSet(xspf, "foreign.xspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.entries[0]!.title).toBe("Weird");
    expect(result.manifest.entries[0]!.claimedMbid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Provenance claims are never imported
// ---------------------------------------------------------------------------

describe("parseImportedSet — provenance is never trusted", () => {
  it("ignores picker/DJ/citation/source meta claims in uploaded files", () => {
    const jspf = JSON.stringify({
      playlist: {
        track: [
          {
            title: "T",
            creator: "C",
            meta: [
              { rel: "lore:citation", content: "https://fake.example/receipt" },
              { rel: "lore:source", content: "playlist" },
              { rel: "lore:picker", content: "some-famous-dj" },
              { rel: "lore:spin_id", content: "12345" },
            ],
          },
        ],
      },
    });
    const result = parseImportedSet(jspf, "claims.jspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.manifest.entries[0]!;
    // The manifest vocabulary has no slot for provenance at all.
    expect(Object.keys(entry).sort()).toEqual(
      [
        "album",
        "claimedIsrc",
        "claimedMbid",
        "claimedMbidFromLore",
        "creator",
        "durationMs",
        "position",
        "title",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Hostile / malformed / over-limit input
// ---------------------------------------------------------------------------

describe("parseImportedSet — rejection feedback", () => {
  it("rejects files over 1 MB before parsing", () => {
    const big = `<playlist>${"x".repeat(IMPORTED_SET_MAX_BYTES)}</playlist>`;
    const result = parseImportedSet(big, "big.xspf");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/1 MB/);
  });

  it("rejects empty uploads", () => {
    const result = parseImportedSet("", "empty.xspf");
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects XML with a DOCTYPE (entity-expansion vector)", () => {
    const hostile = `<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>
<playlist xmlns="http://xspf.org/ns/0/"><trackList><track><title>&lol2;</title></track></trackList></playlist>`;
    const result = parseImportedSet(hostile, "billion-laughs.xspf");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/DTD|entity/i);
  });

  it("rejects XML with external entity declarations", () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<playlist xmlns="http://xspf.org/ns/0/"><trackList><track><title>&xxe;</title></track></trackList></playlist>`;
    expect(parseImportedSet(xxe, "xxe.xspf").ok).toBe(false);
  });

  it("does not expand entity references in parsed values", () => {
    // No DTD, but a sneaky reference — must come through inert, not expanded.
    const xspf = `<?xml version="1.0"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <trackList><track><title>&#x41;mp &amp; co</title><creator>B</creator></track></trackList>
</playlist>`;
    const result = parseImportedSet(xspf, "amp.xspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // processEntities is disabled: the raw reference text is preserved.
    expect(result.manifest.entries[0]!.title).toContain("amp");
  });

  it("rejects malformed XML with a clear message", () => {
    const result = parseImportedSet("<playlist><trackList><track>", "broken.xspf");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/well-formed|XML/i);
  });

  it("rejects malformed JSON with a clear message", () => {
    const result = parseImportedSet("{not json", "broken.jspf");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/JSON/i);
  });

  it("rejects JSON without a playlist object", () => {
    expect(parseImportedSet(JSON.stringify({ tracks: [] }), "x.jspf").ok).toBe(false);
  });

  it("rejects playlists over the 500-track limit", () => {
    const tracks = Array.from({ length: IMPORTED_SET_MAX_TRACKS + 1 }, (_, i) => ({
      title: `T${i}`,
    }));
    const result = parseImportedSet(
      JSON.stringify({ playlist: { track: tracks } }),
      "huge.jspf",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/500/);
  });

  it("rejects unrecognizable file types", () => {
    const result = parseImportedSet("#EXTM3U\n#EXTINF:1,x\nhttp://a/b.mp3", "list.m3u8");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/XSPF|JSPF/);
  });

  it("rejects playlists with zero tracks", () => {
    expect(
      parseImportedSet(JSON.stringify({ playlist: { track: [] } }), "empty.jspf").ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// XSPF/JSPF equivalence + export → import round trip
// ---------------------------------------------------------------------------

function exportModel(): ReplayExportModel {
  const manifest: ReplayManifest = {
    replayId: 7,
    station: { slug: "kexp", name: "KEXP", stationClass: "curated" },
    show: { name: "Morning Show", djName: "DJ Example" },
    picker: null,
    bounds: {
      date: "2026-08-03",
      startedAt: "2026-08-03T10:00:00.000Z",
      endedAt: "2026-08-03T10:02:00.000Z",
    },
    coverage: { total: 2, resolved: 1, unresolved: 1 },
    entries: [
      {
        position: 0,
        spinId: 101,
        playedAt: "2026-08-03T10:00:00.000Z",
        source: "playlist",
        citation: "https://example.test/receipt?slot=0",
        rawArtist: "Fleetwood Mac",
        rawTitle: "Go Your Own Way",
        confidence: "recording_id",
        recording: {
          mbid: UUID_A,
          artist: "Fleetwood Mac",
          title: "Go Your Own Way",
          artworkUrl: null,
          links: [],
        },
        recordingFacts: {
          artistMbid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          isrc: "USABC1234567",
          durationMs: 215000,
          releaseGroup: { mbid: "rg-1", title: "Rumours" },
        },
      },
      {
        position: 1,
        spinId: 102,
        playedAt: "2026-08-03T10:01:00.000Z",
        source: null,
        citation: null,
        rawArtist: "Gap Artist",
        rawTitle: "Gap Title",
        confidence: "unresolved",
        recording: null,
        recordingFacts: null,
      },
    ],
  } as ReplayManifest;
  return {
    ...manifest,
    entries: manifest.entries.map((entry) => ({
      ...entry,
      serviceUrls: [],
      coverageStatus: entry.recording ? "resolved" : "unresolved",
    })),
  };
}

describe("parseImportedSet — Lore export round trip", () => {
  it("re-imports a Lore JSPF export, preferring the Lore MBID", () => {
    const jspf = buildJspf(exportModel(), { exportedAt: "2026-08-04T00:00:00.000Z" });
    const result = parseImportedSet(jspf, "kexp.jspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.entries).toHaveLength(2);
    const first = result.manifest.entries[0]!;
    expect(first.claimedMbid).toBe(UUID_A);
    expect(first.claimedMbidFromLore).toBe(true);
    expect(first.claimedIsrc).toBe("USABC1234567");
    expect(first.durationMs).toBe(215000);
    // The unresolved broadcast slot survives as an ordered entry.
    expect(result.manifest.entries[1]!.title).toBe("Gap Title");
    expect(result.manifest.entries[1]!.claimedMbid).toBeNull();
  });

  it("parses the XSPF export equivalently to the JSPF export", () => {
    const model = exportModel();
    const fromJspf = parseImportedSet(buildJspf(model), "a.jspf");
    const fromXspf = parseImportedSet(buildXspf(model), "a.xspf");
    expect(fromJspf.ok).toBe(true);
    expect(fromXspf.ok).toBe(true);
    if (!fromJspf.ok || !fromXspf.ok) return;
    const strip = (entries: typeof fromJspf.manifest.entries) =>
      entries.map(({ position, title, creator, durationMs, claimedMbid, claimedIsrc, claimedMbidFromLore }) => ({
        position,
        title,
        creator,
        durationMs,
        claimedMbid,
        claimedIsrc,
        claimedMbidFromLore,
      }));
    expect(strip(fromXspf.manifest.entries)).toEqual(strip(fromJspf.manifest.entries));
  });

  it("sniffs format from content when the extension is misleading", () => {
    const jspf = buildJspf(exportModel());
    const result = parseImportedSet(jspf, "mislabeled.xspf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.format).toBe("jspf");
  });
});
