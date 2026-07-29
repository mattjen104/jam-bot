import { describe, it, expect } from "vitest";
import {
  buildCsv,
  buildJson,
  buildM3u8,
  buildTxt,
  csvField,
  isExportFormat,
  type LibraryExportRow,
} from "../src/lore/library-export.js";
import { parseRecordingIsrcs } from "@workspace/song-enrichment";

function row(overrides: Partial<LibraryExportRow> = {}): LibraryExportRow {
  return {
    mbid: "mbid-1",
    title: "Go Your Own Way",
    artist: "Fleetwood Mac",
    album: "Rumours",
    releaseGroupMbid: "rg-1",
    releaseYear: 1977,
    isrc: "USWB19700001",
    addedAt: new Date("2026-07-01T12:00:00Z"),
    provenance: { kind: "keep", stationSlug: "kexp" },
    spin: null,
    ...overrides,
  };
}

describe("csvField (RFC 4180)", () => {
  it("passes plain values through unquoted", () => {
    expect(csvField("Rumours")).toBe("Rumours");
  });
  it("quotes commas, quotes, and newlines", () => {
    expect(csvField('Hello, "World"')).toBe('"Hello, ""World"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });
  it("renders null/undefined as empty string, never 'null'", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("buildCsv", () => {
  it("uses the exact header title,artist,album,isrc", () => {
    const out = buildCsv([row()]);
    expect(out.startsWith("title,artist,album,isrc\r\n")).toBe(true);
    expect(out).toContain("Go Your Own Way,Fleetwood Mac,Rumours,USWB19700001");
  });
  it("exports missing fields as empty, not null", () => {
    const out = buildCsv([row({ album: null, isrc: null })]);
    expect(out).toContain("Go Your Own Way,Fleetwood Mac,,\r\n");
    expect(out).not.toContain("null");
  });
  it("quotes fields containing commas", () => {
    const out = buildCsv([row({ title: "Hello, Goodbye" })]);
    expect(out).toContain('"Hello, Goodbye",Fleetwood Mac');
  });
});

describe("buildJson (lore.library.v1)", () => {
  it("emits the format tag, count, and full item shape", () => {
    const parsed = JSON.parse(buildJson([row()], new Date("2026-07-29T00:00:00Z")));
    expect(parsed.format).toBe("lore.library.v1");
    expect(parsed.count).toBe(1);
    const item = parsed.items[0];
    expect(item).toMatchObject({
      mbid: "mbid-1",
      isrc: "USWB19700001",
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      release_group_mbid: "rg-1",
      album: "Rumours",
      year: 1977,
      added_at: "2026-07-01T12:00:00.000Z",
    });
    expect(item.provenance.kind).toBe("keep");
  });
  it("keeps missing fields null and never fabricates spin context", () => {
    const parsed = JSON.parse(
      buildJson([row({ isrc: null, album: null, releaseGroupMbid: null, releaseYear: null })], new Date()),
    );
    const item = parsed.items[0];
    expect(item.isrc).toBeNull();
    expect(item.album).toBeNull();
    expect(item.provenance.station).toBeUndefined();
    expect(item.provenance.spun_at).toBeUndefined();
  });
  it("includes joined spin context when the keep is spin-linked", () => {
    const parsed = JSON.parse(
      buildJson(
        [row({ spin: { stationSlug: "kexp", stationName: "KEXP", showName: "Drive Time", playedAt: new Date("2026-07-01T11:58:00Z") } })],
        new Date(),
      ),
    );
    const p = parsed.items[0].provenance;
    expect(p.station).toBe("kexp");
    expect(p.station_name).toBe("KEXP");
    expect(p.show).toBe("Drive Time");
    expect(p.spun_at).toBe("2026-07-01T11:58:00.000Z");
  });
});

describe("buildM3u8", () => {
  it("emits #EXTM3U header and EXTINF lines", () => {
    const out = buildM3u8([row()]);
    expect(out.startsWith("#EXTM3U\n")).toBe(true);
    expect(out).toContain("#EXTINF:-1,Fleetwood Mac - Go Your Own Way");
  });
  it("degrades to title only when artist is missing", () => {
    const out = buildM3u8([row({ artist: null })]);
    expect(out).toContain("#EXTINF:-1,Go Your Own Way");
    expect(out).not.toContain(" - Go Your Own Way");
  });
});

describe("buildTxt", () => {
  it("renders Artist — Title (Album, Year)", () => {
    expect(buildTxt([row()])).toBe("Fleetwood Mac — Go Your Own Way (Rumours, 1977)\n");
  });
  it("drops the paren block honestly when album and year are missing", () => {
    expect(buildTxt([row({ album: null, releaseYear: null })])).toBe(
      "Fleetwood Mac — Go Your Own Way\n",
    );
  });
  it("keeps a lone year", () => {
    expect(buildTxt([row({ album: null })])).toBe(
      "Fleetwood Mac — Go Your Own Way (1977)\n",
    );
  });
});

describe("isExportFormat", () => {
  it("accepts the four formats and rejects everything else", () => {
    for (const f of ["csv", "json", "m3u8", "txt"]) expect(isExportFormat(f)).toBe(true);
    expect(isExportFormat("xml")).toBe(false);
    expect(isExportFormat(undefined)).toBe(false);
  });
});

describe("parseRecordingIsrcs", () => {
  it("returns the first non-empty ISRC uppercased", () => {
    expect(parseRecordingIsrcs({ isrcs: ["uswb19700001", "GBAYE0601498"] })).toBe(
      "USWB19700001",
    );
  });
  it("returns null on empty or malformed bodies", () => {
    expect(parseRecordingIsrcs({ isrcs: [] })).toBeNull();
    expect(parseRecordingIsrcs({})).toBeNull();
    expect(parseRecordingIsrcs(null)).toBeNull();
    expect(parseRecordingIsrcs({ isrcs: ["", "  "] })).toBeNull();
  });
});
