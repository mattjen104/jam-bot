import { describe, expect, it } from "vitest";
import {
  buildJspf,
  buildM3u8,
  buildReplayCsv,
  buildReplayExport,
  buildXspf,
  isReplayExportFormat,
  materializeReplayExport,
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
      },
    ],
  };
}

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
    expect(output.split("\r\n")).toHaveLength(5);
    expect(output).toContain('0,101,2026-08-03T10:00:00.000Z,"Artist, One","Track ""A""",recording-1');
    expect(output).toContain("1,102,2026-08-03T10:01:00.000Z,Gap Artist,Gap <Title>,,,,unresolved,unresolved,,");
    expect(output).toContain("https://example.test/receipt?slot=0");
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