// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  creditIdentityHref,
  groupCredits,
  isKeptAlbum,
  isKeptRecording,
  normalizeCreditPayload,
} from "../src/lib/creditPayload";
import {
  appendReturnState,
  captureReturnState,
  normalizeAppRelativePath,
  readReturnState,
  readScrollState,
} from "../src/lib/returnState";

describe("kept credit payload", () => {
  it("gates credit surfaces to active kept identities", () => {
    expect(isKeptRecording({ mbids: ["recording-1"] }, "recording-1")).toBe(true);
    expect(isKeptRecording({ mbids: ["recording-1"] }, "recording-2")).toBe(false);
    expect(isKeptAlbum({ releaseGroupMbids: ["album-1"] }, "album-1")).toBe(true);
    expect(isKeptAlbum(undefined, "album-1")).toBe(false);
  });
  it("keeps every work/role and links only canonical identities", () => {
    const payload = normalizeCreditPayload({
      status: "partial",
      credits: [
        { creditedName: "Writer", role: "writer", artistMbid: "artist-1" },
        { creditedName: "Approximate producer", role: "producer" },
      ],
      releases: [{ releaseMbid: "release-1", labelName: "Small Label", labelMbid: "label-1" }],
      tracks: [{ mbid: "track-1", credits: [{ creditedName: "Mixer", role: "mixer" }] }],
    });
    expect(payload.completeness).toBe("partial");
    expect(payload.credits).toHaveLength(3);
    expect(groupCredits(payload.credits).map(([group]) => group)).toEqual(["writing", "production", "engineering"]);
    expect(creditIdentityHref(payload.credits[0]!.identity!)).toBe("/credits/artist/artist-1");
    expect(payload.labels[0]!.labelId).toBe("label-1");
    expect(payload.trackCredits?.["track-1"]?.credits[0]?.name).toBe("Mixer");
  });

  it("does not turn approximate or text-only facts into links", () => {
    const payload = normalizeCreditPayload({
      approximate: true,
      credits: [{ creditedName: "Unresolved person", role: "performer" }],
      releases: [{ labelName: "Text label" }],
    });
    expect(payload.credits[0]!.identity).toBeUndefined();
    expect(payload.labels[0]!.approximate).toBe(true);
  });

  it("promotes canonical track credits into the album-wide aggregate", () => {
    const payload = normalizeCreditPayload({
      releases: [{ labelName: "Label", labelMbid: "label-1" }],
      tracks: [{
        mbid: "track-1",
        title: "Track one",
        credits: [{ creditedName: "Producer", role: "producer", artistMbid: "producer-1" }],
      }, {
        mbid: "track-2",
        title: "Track two",
        credits: [{ creditedName: "Producer", role: "producer", artistMbid: "producer-1" }],
      }],
    });
    expect(payload.credits).toHaveLength(1);
    expect(payload.credits[0]).toMatchObject({
      group: "production",
      name: "Producer",
      identity: { id: "producer-1" },
    });
    expect(payload.trackCredits?.["track-1"]?.credits).toHaveLength(1);
  });

  it("keeps mixed terminal and pending evidence partial", () => {
    const payload = normalizeCreditPayload({
      status: "complete",
      tracks: [
        { mbid: "track-done", status: "complete", credits: [{ creditedName: "Producer", role: "producer" }] },
        { mbid: "track-pending", status: "pending", credits: [] },
      ],
    });
    expect(payload.status).toBe("partial");
    expect(payload.completeness).toBe("partial");
  });

  it("preserves distinct release editions and freshness provenance", () => {
    const payload = normalizeCreditPayload({
      status: "complete",
      parserVersion: "credits-v3",
      fetchedAtMs: 1700000000000,
      provenance: { source: "musicbrainz", stale: true },
      releases: [
        {
          releaseMbid: "release-a",
          releaseGroupMbid: "group-1",
          title: "Album (CD)",
          releaseDate: "1999-01-01",
          status: "official",
          country: "US",
          labelMbid: "label-a",
          labelName: "Label A",
          catalogNumber: "CAT-01",
        },
        {
          releaseMbid: "release-b",
          releaseGroupMbid: "group-1",
          title: "Album (LP)",
          releaseDate: "1999-02-01",
          status: "official",
          country: "GB",
          labelMbid: "label-b",
          labelName: "Label B",
          catalogNumber: "CAT-02",
        },
      ],
    });
    expect(payload.labels).toHaveLength(2);
    expect(payload.labels.map((edition) => edition.releaseId)).toEqual(["release-a", "release-b"]);
    expect(payload.labels.map((edition) => edition.catalogNumber)).toEqual(["CAT-01", "CAT-02"]);
    expect(payload.parserVersion).toBe("credits-v3");
    expect(payload.fetchedAt).toBe(1700000000000);
    expect(payload.stale).toBe(true);
  });
});

describe("canonical return state", () => {
  it("round-trips the full Library URL and rejects external destinations", () => {
    const library = "/library?view=songs&focus=Artist&sort=album&layout=grid";
    const href = appendReturnState("/song/recording-1", library);
    expect(readReturnState(href.slice(href.indexOf("?")))).toBe(library);
    expect(appendReturnState("/song/recording-1", "https://evil.test")).toBe("/song/recording-1");
  });

  it("captures and reads exact scroll position without dropping Library state", () => {
    const library = "/library?view=songs&sort=album&layout=grid";
    const captured = captureReturnState(library, 847.6);
    expect(captured).toContain("view=songs");
    expect(captured).toContain("sort=album");
    expect(readScrollState(captured.slice(captured.indexOf("?")))).toBe(847.6);
  });

  it("normalizes one proxied app prefix before constructing the Back to Library link", () => {
    const returnTo = readReturnState("?returnTo=%2Flore%2Flibrary%3Fview%3Dsongs");
    expect(returnTo).toBe("/library?view=songs");
    expect(normalizeAppRelativePath("/lore/library?view=songs")).toBe("/library?view=songs");
    expect(appendReturnState("/song/recording-1", returnTo))
      .toBe("/song/recording-1?returnTo=%2Flibrary%3Fview%3Dsongs");
    expect(readReturnState("?returnTo=%2F%2Fevil.test%2Flibrary")).toBeNull();
  });
});