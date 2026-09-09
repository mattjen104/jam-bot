// @vitest-environment node
/**
 * Unit tests for the release-metadata resolver's pure seams:
 *   - pickPrimaryReleaseMetadata: earliest plain-Album group wins; Official
 *     release fallback; arbitrary-group last resort; empty → null.
 *   - parseRecordingSearchResults: dedupes release groups per recording,
 *     ignores recordings that were never requested, derives releaseYear from
 *     the group's first-release-date.
 *
 * DB-backed hydration behaviour lives in release-metadata-db.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  pickPrimaryReleaseMetadata,
  parseRecordingSearchResults,
} from "../src/lore/release-metadata.js";

const ALBUM_GROUP = {
  id: "rg-album",
  title: "OK Computer",
  "primary-type": "Album",
  "secondary-types": [],
  "first-release-date": "1997-05-21",
};

describe("pickPrimaryReleaseMetadata", () => {
  it("prefers the earliest plain Album group", () => {
    const result = pickPrimaryReleaseMetadata({
      releases: [
        { date: "1998-01-01", "release-group": {
          id: "rg-reissue", title: "OK Computer (Reissue)",
          "primary-type": "Album", "secondary-types": ["Compilation"],
          "first-release-date": "1998-01-01",
        } },
        { date: "1997-06-16", "release-group": ALBUM_GROUP },
      ],
    });
    expect(result).toEqual({ title: "OK Computer", releaseGroupMbid: "rg-album" });
  });

  it("falls back to the earliest Official release's group", () => {
    const result = pickPrimaryReleaseMetadata({
      releases: [
        { date: "2001-01-01", status: "Promotion", "release-group": {
          id: "rg-promo", title: "Promo", "primary-type": "Single",
          "first-release-date": "2000-01-01",
        } },
        { date: "2002-01-01", status: "Official", "release-group": {
          id: "rg-single", title: "Single", "primary-type": "Single",
          "first-release-date": "2002-01-01",
        } },
      ],
    });
    expect(result).toEqual({ title: "Single", releaseGroupMbid: "rg-single" });
  });

  it("uses the earliest group at all when nothing is Official", () => {
    const result = pickPrimaryReleaseMetadata({
      releases: [
        { date: "2005-05-05", "release-group": {
          id: "rg-late", title: "Late Bootleg", "first-release-date": "2005-05-05",
        } },
        { date: "2003-03-03", "release-group": {
          id: "rg-early", title: "Early Bootleg", "first-release-date": "2003-03-03",
        } },
      ],
    });
    expect(result).toEqual({ title: "Early Bootleg", releaseGroupMbid: "rg-early" });
  });

  it("returns null when no release carries a usable group", () => {
    expect(pickPrimaryReleaseMetadata({})).toBeNull();
    expect(pickPrimaryReleaseMetadata({ releases: [] })).toBeNull();
    expect(pickPrimaryReleaseMetadata({
      releases: [{ date: "2000-01-01" }],
    })).toBeNull();
  });

  it("uses the release's own title when the nested group has none (search-projection shape)", () => {
    // Real /recording?query=… hits carry title/date on the RELEASE; the
    // nested release-group often has only id + type fields.
    const result = pickPrimaryReleaseMetadata({
      releases: [{
        title: "OK Computer",
        date: "1997-05-21",
        status: "Official",
        "release-group": { id: "rg-sparse", "primary-type": "Album" },
      }],
    });
    expect(result).toEqual({ title: "OK Computer", releaseGroupMbid: "rg-sparse" });
  });
});

describe("parseRecordingSearchResults", () => {
  it("collects distinct groups per recording and derives releaseYear", () => {
    const out = parseRecordingSearchResults({
      recordings: [{
        id: "rec-1",
        releases: [
          { "release-group": ALBUM_GROUP },
          { "release-group": ALBUM_GROUP }, // duplicate release of same group
          { "release-group": {
            id: "rg-single", title: "Karma Police",
            "primary-type": "Single", "first-release-date": "1997",
          } },
        ],
      }],
    }, new Set(["rec-1"]));

    const parsed = out.get("rec-1");
    expect(parsed?.groups).toHaveLength(2);
    expect(parsed?.groups[0]).toEqual({
      releaseGroupMbid: "rg-album",
      title: "OK Computer",
      primaryType: "Album",
      releaseYear: 1997,
    });
    expect(parsed?.primary).toEqual({ title: "OK Computer", releaseGroupMbid: "rg-album" });
  });

  it("ignores recordings that were never requested", () => {
    const out = parseRecordingSearchResults({
      recordings: [{ id: "rec-stray", releases: [{ "release-group": ALBUM_GROUP }] }],
    }, new Set(["rec-1"]));
    expect(out.size).toBe(0);
  });

  it("reports a null primary for recordings with no usable group", () => {
    const out = parseRecordingSearchResults({
      recordings: [{ id: "rec-1", releases: [] }],
    }, new Set(["rec-1"]));
    expect(out.get("rec-1")).toEqual({ groups: [], primary: null });
  });

  it("falls back to release-level title/date for sparse search-projection groups", () => {
    const out = parseRecordingSearchResults({
      recordings: [{
        id: "rec-1",
        releases: [{
          title: "OK Computer",
          date: "1997-05-21",
          status: "Official",
          "release-group": { id: "rg-sparse", "primary-type": "Album" },
        }],
      }],
    }, new Set(["rec-1"]));
    expect(out.get("rec-1")).toEqual({
      groups: [{
        releaseGroupMbid: "rg-sparse",
        title: "OK Computer",
        primaryType: "Album",
        releaseYear: 1997,
      }],
      primary: { title: "OK Computer", releaseGroupMbid: "rg-sparse" },
    });
  });
});
