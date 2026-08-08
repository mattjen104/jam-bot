import { describe, expect, it } from "vitest";
import {
  buildJspf,
  buildM3u8,
  buildReplayCsv,
  buildReplayExport,
  buildXspf,
  isReplayExportFormat,
  materializeReplayExport,
  replayTracksChecksum,
  type ReplayExportModel,
} from "../src/lore/replay-export.js";
import type { ReplayManifest } from "../src/lore/replay.js";

function manifest(): ReplayManifest {
  return {
    replayId: 41,
    station: { slug: "kexp", name: "KEXP", stationClass: "curated" },
    show: { name: "Morning Show", djName: "DJ Example" },
    picker: null,
    bounds: {
      date: "2026-08-03",
      startedAt: "2026-08-03T10:00:00.000Z",
      endedAt: "2026-08-03T10:02:00.000Z",
    },
    coverage: { total: 3, resolved: 2, unresolved: 1 },
    entries: [
      {
        position: 0,
        spinId: 101,
        playedAt: "2026-08-03T10:00:00.000Z",
        source: "playlist",
        citation: "https://example.test/receipt?slot=0",
        rawArtist: "Artist, One",
        rawTitle: "Track \"A\"",
        confidence: "recording_id",
        recording: {
          mbid: "recording-1",
          artist: "Artist, One",
          title: "Track \"A\"",
          artworkUrl: null,
          links: [
            { name: "Spotify", url: "https://open.spotify.com/track/exact-1", kind: "exact" },
            { name: "Search", url: "https://example.test/search?q=near", kind: "search" },
          ],
        },
        recordingFacts: {
          artistMbid: "artist-mbid-1",
          isrc: "USABC1234567",
          durationMs: 215000,
          releaseGroup: { mbid: "rg-1", title: "Album, One" },
        },
      },
      {
        position: 1,
        spinId: 102,
        playedAt: "2026-08-03T10:01:00.000Z",
        source: null,
        citation: null,
        rawArtist: "Gap Artist",
        rawTitle: "Gap <Title>",
        confidence: "unresolved",
        recording: null,
        recordingFacts: null,
      },
      {
        position: 2,
        spinId: 103,
        playedAt: "2026-08-03T10:02:00.000Z",
        source: "playlist",
        citation: null,
        rawArtist: "Artist Three",
        rawTitle: "Track Three",
        confidence: "text",
        recording: {
          mbid: "recording-3",
          artist: "Artist Three",
          title: "Track Three",
          artworkUrl: null,
          links: [],
        },
        recordingFacts: {
          artistMbid: null,
          isrc: null,
          durationMs: null,
          releaseGroup: null,
        },
      },
    ],
  };
}

const EXPORTED_AT = "2026-08-08T12:00:00.000Z";

function model(): ReplayExportModel {
  return materializeReplayExport(manifest(), new Map([
    ["recording-3", [{ service: "apple_music", url: "https://music.example/track/3", deadLink: false, confidence: "exact" }]],
  ]));
}

describe("Ghost Replay export builders", () => {
  it("keeps one immutable ordered row for every broadcast slot", () => {
    const result = model();
    expect(result.entries.map((entry) => entry.position)).toEqual([0, 1, 2]);
    expect(result.entries.map((entry) => entry.spinId)).toEqual([101, 102, 103]);
    expect(result.entries.map((entry) => entry.coverageStatus)).toEqual([
      "resolved",
      "unresolved",
      "resolved",
    ]);
  });

  it("only emits exact links and marks dead or absent service mappings honestly", () => {
    const input = manifest();
    input.entries[0]!.recording!.links = [
      { name: "Near match", url: "https://example.test/search", kind: "search" },
    ];
    const result = materializeReplayExport(input, new Map([
      ["recording-1", [{ service: "spotify", url: "https://music.example/dead", deadLink: true, confidence: "exact" }]],
    ]));
    expect(result.entries[0]!.serviceUrls).toEqual([]);
    expect(result.entries[0]!.coverageStatus).toBe("dead-link");
    expect(result.entries[2]!.coverageStatus).toBe("not-on-service");
  });

  it("writes JSPF with MBID identifiers, receipt metadata, and unresolved tracks", () => {
    const parsed = JSON.parse(buildJspf(model()));
    expect(parsed.playlist.track).toHaveLength(3);
    expect(parsed.playlist.track.map((track: { title: string }) => track.title)).toEqual([
      'Track "A"',
      "Gap <Title>",
      "Track Three",
    ]);
    expect(parsed.playlist.track[0].identifier).toEqual([
      "https://musicbrainz.org/recording/recording-1",
    ]);
    expect(parsed.playlist.track[1].identifier).toBeUndefined();
    expect(parsed.playlist.track[1].meta).toContainEqual({
      rel: "lore:coverage_status",
      content: "unresolved",
    });
  });

  it("writes valid escaped XSPF and preserves gaps without fake locations", () => {
    const output = buildXspf(model());
    expect(output).toContain("<title>Gap &lt;Title&gt;</title>");
    expect(output).toContain("<lore:spin_id>102</lore:spin_id>");
    expect(output).toContain("https://open.spotify.com/track/exact-1");
    expect(output).not.toContain("https://example.test/search?q=near");
    expect((output.match(/<track>/g) ?? []).length).toBe(3);
    expect((output.match(/<location>/g) ?? []).length).toBe(2);
  });

  it("keeps M3U8 slots in order and marks unresolved slots as gaps", () => {
    const output = buildM3u8(model());
    expect(output.indexOf("exact-1")).toBeLessThan(output.indexOf("Gap Artist - Gap <Title>"));
    expect(output).toContain(
      "#EXT-X-GAP\n# lore:position=1 spin_id=102 coverage=unresolved",
    );
    expect(output).toContain("https://music.example/track/3");
  });

  it("writes a lossless escaped CSV receipt", () => {
    const output = buildReplayCsv(model());
    expect(output.split("\r\n")).toHaveLength(8);
    expect(output).toContain('0,101,2026-08-03T10:00:00.000Z,"Artist, One","Track ""A""",recording-1');
    expect(output).toContain("1,102,2026-08-03T10:01:00.000Z,Gap Artist,Gap <Title>,,,,unresolved,unresolved,,");
    expect(output).toContain("https://example.test/receipt?slot=0");
  });

  it("enriches JSPF with identifiers, album, standard duration, and export metadata", () => {
    const parsed = JSON.parse(buildJspf(model(), { exportedAt: EXPORTED_AT }));
    expect(parsed.playlist.date).toBe(EXPORTED_AT);
    expect(parsed.playlist.meta).toContainEqual({ rel: "lore:generator", content: "Lore Ghost Replay" });
    expect(parsed.playlist.meta).toContainEqual({ rel: "lore:exported-at", content: EXPORTED_AT });
    expect(parsed.playlist.meta).toContainEqual({
      rel: "lore:tracks-sha256",
      content: replayTracksChecksum(model()),
    });

    const [first, gap, third] = parsed.playlist.track;
    expect(first.album).toBe("Album, One");
    expect(first.duration).toBe(215000);
    expect(first.meta).toContainEqual({ rel: "lore:recording_mbid", content: "recording-1" });
    expect(first.meta).toContainEqual({ rel: "lore:artist_mbid", content: "artist-mbid-1" });
    expect(first.meta).toContainEqual({ rel: "lore:isrc", content: "USABC1234567" });
    expect(first.meta).toContainEqual({ rel: "lore:album_mbid", content: "rg-1" });
    expect(first.meta).toContainEqual({ rel: "lore:album_title", content: "Album, One" });

    // Absent facts are omitted, never emitted empty or zero.
    for (const track of [gap, third]) {
      expect(track.album).toBeUndefined();
      expect(track.duration).toBeUndefined();
      const rels = track.meta.map((m: { rel: string }) => m.rel);
      expect(rels).not.toContain("lore:artist_mbid");
      expect(rels).not.toContain("lore:isrc");
      expect(rels).not.toContain("lore:duration_ms");
      expect(rels).not.toContain("lore:album_mbid");
      expect(rels).not.toContain("lore:album_title");
    }
    expect(gap.meta.map((m: { rel: string }) => m.rel)).not.toContain("lore:recording_mbid");
  });

  it("enriches XSPF with identifiers, album, duration, and playlist metadata", () => {
    const output = buildXspf(model(), { exportedAt: EXPORTED_AT });
    expect(output).toContain("<creator>Lore Ghost Replay</creator>");
    expect(output).toContain(`<date>${EXPORTED_AT}</date>`);
    expect(output).toContain(
      `<meta rel="https://lore.radio/ghost-replay/tracks-sha256">${replayTracksChecksum(model())}</meta>`,
    );
    expect(output).toContain("<album>Album, One</album>");
    expect(output).toContain("<duration>215000</duration>");
    expect(output).toContain(
      "<identifier>https://musicbrainz.org/artist/artist-mbid-1</identifier>",
    );
    expect(output).toContain("<lore:isrc>USABC1234567</lore:isrc>");
    expect(output).toContain("<lore:album_mbid>rg-1</lore:album_mbid>");
    // Null facts stay omitted: only track one carries album/duration/isrc.
    expect((output.match(/<album>/g) ?? []).length).toBe(1);
    expect((output.match(/<duration>/g) ?? []).length).toBe(1);
    expect((output.match(/<lore:isrc>/g) ?? []).length).toBe(1);
    // Still valid, gap-preserving output.
    expect((output.match(/<track>/g) ?? []).length).toBe(3);
  });

  it("appends interoperable CSV columns without moving existing ones", () => {
    const output = buildReplayCsv(model(), { exportedAt: EXPORTED_AT });
    const [genComment, timeComment, checksumComment, header, first, gap] = output.split("\r\n");
    // Metadata rides as leading comment records so the data schema is untouched.
    expect(genComment).toBe("# generator: Lore Ghost Replay");
    expect(timeComment).toBe(`# exported-at: ${EXPORTED_AT}`);
    expect(checksumComment).toBe(`# tracks-sha256: ${replayTracksChecksum(model())}`);
    expect(header).toBe(
      "position,spin_id,played_at,raw_artist,raw_title,mbid,artist,title,coverage_status,confidence,source,citation,artist_mbid,isrc,duration_ms,album_mbid,album_title",
    );
    expect(first).toContain(',artist-mbid-1,USABC1234567,215000,rg-1,"Album, One"');
    expect(gap!.endsWith(",,,,,")).toBe(true);
  });

  it("embeds the same injected export time and checksum in CSV as in JSPF/XSPF", () => {
    const jspf = JSON.parse(buildJspf(model(), { exportedAt: EXPORTED_AT }));
    const xspf = buildXspf(model(), { exportedAt: EXPORTED_AT });
    const csv = buildReplayCsv(model(), { exportedAt: EXPORTED_AT });
    const checksum = jspf.playlist.meta.find(
      (m: { rel: string }) => m.rel === "lore:tracks-sha256",
    )!.content;
    expect(xspf).toContain(checksum);
    expect(csv).toContain(`# tracks-sha256: ${checksum}`);
    expect(csv).toContain(`# exported-at: ${EXPORTED_AT}`);
    expect(xspf).toContain(EXPORTED_AT);
  });

  it("produces a stable documented checksum independent of export time and links", () => {
    expect(replayTracksChecksum(model())).toBe(replayTracksChecksum(model()));
    expect(replayTracksChecksum(model())).toMatch(/^[0-9a-f]{64}$/);
    // Service-link differences must not change the checksum.
    const bare = materializeReplayExport(manifest(), new Map());
    expect(replayTracksChecksum(bare)).toBe(replayTracksChecksum(model()));
    // Two exports at different times embed the same checksum.
    const a = JSON.parse(buildJspf(model(), { exportedAt: "2026-01-01T00:00:00.000Z" }));
    const b = JSON.parse(buildJspf(model(), { exportedAt: "2026-02-02T00:00:00.000Z" }));
    const checksum = (p: { playlist: { meta: Array<{ rel: string; content: string }> } }) =>
      p.playlist.meta.find((m) => m.rel === "lore:tracks-sha256")!.content;
    expect(checksum(a)).toBe(checksum(b));
    // Reordering tracks changes it.
    const reordered = model();
    reordered.entries = [reordered.entries[1]!, reordered.entries[0]!, reordered.entries[2]!];
    expect(replayTracksChecksum(reordered)).not.toBe(replayTracksChecksum(model()));
  });

  it("selects all supported formats and rejects unknown formats", () => {
    for (const format of ["jspf", "xspf", "m3u8", "csv"]) {
      expect(isReplayExportFormat(format)).toBe(true);
      expect(buildReplayExport(format, model())).toBeTypeOf("string");
    }
    expect(isReplayExportFormat("json")).toBe(false);
    expect(isReplayExportFormat(undefined)).toBe(false);
  });
});