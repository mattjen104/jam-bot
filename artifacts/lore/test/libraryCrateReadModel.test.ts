import { describe, expect, it } from "vitest";
import {
  attendanceCopy,
  buildAddedArtists,
  buildCrateReleases,
  crateTilt,
  hasGenuineKeepDate,
  keepCopy,
  partitionCrateItems,
  primaryReleaseMetadata,
  sortCrateReleases,
} from "../src/components/LibraryCrate";
import type { LibraryItem } from "../src/lib/meHooks";

function item(overrides: Partial<LibraryItem> & {
  mbid: string | null;
  date: string;
  title: string;
  artist?: string;
  release?: string | null;
  album?: string | null;
  kind?: string;
  sourceKeepDate?: boolean;
}): LibraryItem {
  return {
    mbid: overrides.mbid,
    addedAt: overrides.date,
    provenance: {
      kind: overrides.kind ?? "keep",
      service: overrides.kind === "import" ? "spotify" : undefined,
      sourceKeepDate: overrides.sourceKeepDate,
      stationName: overrides.kind === "keep" ? "WFMU" : undefined,
      pickerName: overrides.kind === "keep" ? "The Lot" : undefined,
    },
    recording: {
      title: overrides.title,
      artist: overrides.artist ?? "Artist",
      artistMbid: null,
      artworkUrl: null,
      albumTitle: overrides.album === undefined ? "Album" : overrides.album,
      releaseGroupMbid: overrides.release === undefined ? "rg-1" : overrides.release,
      releaseYear: 1999,
      spotifyUrl: null,
    },
    ...overrides,
  };
}

describe("Library crate read model", () => {
  it("selects the earliest plain album from MusicBrainz release metadata", () => {
    expect(primaryReleaseMetadata({
      releases: [
        {
          date: "2005-01-01",
          status: "Official",
          "release-group": {
            id: "single-rg",
            title: "The Song",
            "primary-type": "Single",
          },
        },
        {
          date: "2002-03-04",
          status: "Official",
          "release-group": {
            id: "album-rg",
            title: "The Album",
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
      ],
    })).toEqual({ title: "The Album", releaseGroupMbid: "album-rg" });
  });

  it("mixes Lore catches and genuinely dated imports in one chronological pile", () => {
    const oldImport = item({
      mbid: "spotify-old",
      title: "Old like",
      date: "2021-01-02T00:00:00.000Z",
      kind: "import",
      sourceKeepDate: true,
      release: "rg-old",
    });
    const recentCatch = item({
      mbid: "lore-new",
      title: "Last night's catch",
      date: "2026-08-26T00:00:00.000Z",
      release: "rg-new",
    });
    const undated = item({
      mbid: "manual",
      title: "No source date",
      artist: "Zulu",
      date: "2026-08-27T00:00:00.000Z",
      kind: "import",
      sourceKeepDate: false,
      release: "rg-undated",
    });

    const partition = partitionCrateItems([oldImport, recentCatch, undated]);
    const releases = sortCrateReleases(buildCrateReleases(partition.dated), "added");
    expect(releases.map((release) => release.caught.mbid)).toEqual(["lore-new", "spotify-old"]);
    expect(partition.undated).toEqual([undated]);
  });

  it("groups resolved catches by release but leaves unresolved recordings separate", () => {
    const first = item({ mbid: "a", title: "A", date: "2026-01-01T00:00:00Z", release: "rg-x" });
    const second = item({ mbid: "b", title: "B", date: "2026-02-01T00:00:00Z", release: "rg-x" });
    const unresolved = item({ mbid: "c", title: "C", date: "2026-03-01T00:00:00Z", release: null, album: null });
    const releases = buildCrateReleases([first, second, unresolved]);
    expect(releases).toHaveLength(2);
    expect(releases.find((release) => release.key === "release:rg-x")?.caught.mbid).toBe("b");
    expect(releases.find((release) => release.kind === "unresolved")?.title).toBeNull();
  });

  it("keeps Added artists alphabetical under every source of membership", () => {
    const undated = item({
      mbid: "undated",
      title: "Song",
      artist: "Beta",
      date: "2026-01-01T00:00:00Z",
      kind: "import",
      sourceKeepDate: false,
    });
    const added = buildAddedArtists(["Zulu", "Alpha", "alpha"], {}, [undated]);
    expect(added.map((artist) => artist.name)).toEqual(["Alpha", "Beta", "Zulu"]);
  });

  it("uses honest provenance and unknown attendance grammar", () => {
    const foreign = item({
      mbid: "foreign",
      title: "Song",
      date: "2021-09-12T00:00:00Z",
      kind: "import",
      sourceKeepDate: true,
    });
    expect(keepCopy(foreign)).toContain("Liked 12 Sept 2021 · spotify");
    expect(attendanceCopy(null)).toBe("Release unknown — no group resolved");
    expect(attendanceCopy("rg", { heard: 0, total: 10 })).toBe("");
    expect(attendanceCopy("rg", { heard: 2, total: 10 })).toBe("Heard 2 of 10");
    expect(attendanceCopy("rg", { heard: 2, total: 10, sinceAdding: true })).toBe("Heard 2 of 10 since adding");
    expect(attendanceCopy("rg", { heard: 2, total: 10 })).not.toContain("since adding");
  });

  it("only treats source-backed imported timestamps as genuine", () => {
    expect(hasGenuineKeepDate(item({
      mbid: "a", title: "A", date: "2026-01-01T00:00:00Z", kind: "import", sourceKeepDate: true,
    }))).toBe(true);
    expect(hasGenuineKeepDate(item({
      mbid: "b", title: "B", date: "2026-01-01T00:00:00Z", kind: "import", sourceKeepDate: false,
    }))).toBe(false);
  });

  it("produces stable alternating tilts in the required range", () => {
    const first = crateTilt("release:one", 0);
    const again = crateTilt("release:one", 0);
    const second = crateTilt("release:two", 1);
    expect(first).toBe(again);
    expect(Math.abs(first)).toBeGreaterThanOrEqual(5);
    expect(Math.abs(first)).toBeLessThanOrEqual(12);
    expect(first).toBeLessThan(0);
    expect(second).toBeGreaterThan(0);
  });
});