import { describe, it, expect } from "vitest";
import { buildJson, type LibraryExportRow } from "../src/lore/library-export.js";
import { parseLibraryImport, IMPORT_MAX_ITEMS } from "../src/lore/library-import.js";

const MBID_A = "aaaaaaaa-1111-2222-3333-444444444444";
const MBID_B = "bbbbbbbb-1111-2222-3333-444444444444";

function row(overrides: Partial<LibraryExportRow> = {}): LibraryExportRow {
  return {
    mbid: MBID_A,
    title: "Go Your Own Way",
    artist: "Fleetwood Mac",
    album: "Rumours",
    releaseGroupMbid: null,
    releaseYear: 1977,
    isrc: "USRE17700001",
    addedAt: new Date("2026-07-01T12:00:00.000Z"),
    provenance: { kind: "keep" },
    spin: null,
    ...overrides,
  };
}

describe("parseLibraryImport — structural rejection", () => {
  it("rejects non-object bodies", () => {
    for (const body of [null, "x", 5, ["a"]]) {
      const r = parseLibraryImport(body);
      expect(r.ok).toBe(false);
    }
  });

  it("rejects wrong or missing format with a clear message", () => {
    const r = parseLibraryImport({ format: "lore.library.v2", items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("lore.library.v1");
    const r2 = parseLibraryImport({ items: [] });
    expect(r2.ok).toBe(false);
  });

  it("rejects a missing items array", () => {
    const r = parseLibraryImport({ format: "lore.library.v1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("items");
  });

  it("rejects oversized files", () => {
    const items = new Array(IMPORT_MAX_ITEMS + 1).fill({});
    const r = parseLibraryImport({ format: "lore.library.v1", items });
    expect(r.ok).toBe(false);
  });
});

describe("parseLibraryImport — per-item validation (never partial-silent)", () => {
  it("collects indexed errors for bad items while accepting good ones", () => {
    const good = {
      mbid: MBID_A,
      added_at: "2026-07-01T12:00:00.000Z",
      provenance: { kind: "keep" },
    };
    const r = parseLibraryImport({
      format: "lore.library.v1",
      items: [
        good,
        { added_at: "2026-07-01T12:00:00.000Z", provenance: { kind: "keep" } }, // no mbid
        { mbid: MBID_B, provenance: { kind: "keep" } }, // no added_at
        { mbid: MBID_B, added_at: "not-a-date", provenance: { kind: "keep" } },
        { mbid: MBID_B, added_at: "2026-07-01T12:00:00.000Z" }, // no provenance
        { mbid: MBID_B, added_at: "2026-07-01T12:00:00.000Z", provenance: { kind: "" } },
        "not an object",
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0]?.sourceIndex).toBe(0);
      expect(r.itemErrors.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6]);
      for (const e of r.itemErrors) expect(e.reason).toBeTruthy();
    }
  });

  it("preserves original file position on sourceIndex when earlier items are invalid", () => {
    const r = parseLibraryImport({
      format: "lore.library.v1",
      items: [
        "bad",
        { mbid: MBID_A, added_at: "2026-07-01T00:00:00Z", provenance: { kind: "keep" } },
        "bad",
        { mbid: MBID_B, added_at: "2026-07-01T00:00:00Z", provenance: { kind: "keep" } },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items.map((i) => i.sourceIndex)).toEqual([1, 3]);
  });

  it("normalizes mbid case and rejects malformed mbids", () => {
    const r = parseLibraryImport({
      format: "lore.library.v1",
      items: [
        { mbid: MBID_A.toUpperCase(), added_at: "2026-07-01T00:00:00Z", provenance: { kind: "keep" } },
        { mbid: "not-a-uuid", added_at: "2026-07-01T00:00:00Z", provenance: { kind: "keep" } },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items[0]?.mbid).toBe(MBID_A);
      expect(r.itemErrors).toHaveLength(1);
    }
  });
});

describe("round-trip: export buildJson → parseLibraryImport", () => {
  it("reproduces mbid, added_at, and provenance verbatim (incl. spin context)", () => {
    const rows: LibraryExportRow[] = [
      row(),
      row({
        mbid: MBID_B,
        title: "Dreams",
        artist: "Fleetwood Mac",
        album: null,
        releaseYear: null,
        isrc: null,
        addedAt: new Date("2026-06-15T08:30:00.000Z"),
        provenance: { kind: "keep", note: "late-night dial" } as never,
        spin: {
          stationSlug: "kexp",
          stationName: "KEXP",
          showName: "Morning Show",
          playedAt: new Date("2026-06-15T08:29:00.000Z"),
        },
      }),
    ];

    const json = buildJson(rows, new Date("2026-07-29T00:00:00.000Z"));
    const r = parseLibraryImport(JSON.parse(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itemErrors).toHaveLength(0);
    expect(r.items).toHaveLength(2);

    const [a, b] = r.items;
    expect(a!.mbid).toBe(MBID_A);
    expect(a!.addedAt.toISOString()).toBe(rows[0]!.addedAt.toISOString());
    expect(a!.provenance).toEqual({ kind: "keep" });
    expect(a!.title).toBe("Go Your Own Way");
    expect(a!.artist).toBe("Fleetwood Mac");
    expect(a!.isrc).toBe("USRE17700001");
    expect(a!.releaseYear).toBe(1977);

    // Spin-derived provenance keys survive verbatim.
    expect(b!.provenance).toEqual({
      kind: "keep",
      note: "late-night dial",
      station: "kexp",
      station_name: "KEXP",
      show: "Morning Show",
      spun_at: "2026-06-15T08:29:00.000Z",
    });
    expect(b!.addedAt.toISOString()).toBe("2026-06-15T08:30:00.000Z");
    // Null fields stay null — honesty preserved through the trip.
    expect(b!.isrc).toBeNull();
    expect(b!.releaseYear).toBeNull();
  });

  it("double round-trip is stable (import fields re-export identically)", () => {
    const rows = [row()];
    const json = buildJson(rows, new Date("2026-07-29T00:00:00.000Z"));
    const r1 = parseLibraryImport(JSON.parse(json));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Re-export from the parsed item (as the server would after insert).
    const rows2: LibraryExportRow[] = [
      row({ addedAt: r1.items[0]!.addedAt, provenance: r1.items[0]!.provenance }),
    ];
    expect(buildJson(rows2, new Date("2026-07-29T00:00:00.000Z"))).toBe(json);
  });
});
