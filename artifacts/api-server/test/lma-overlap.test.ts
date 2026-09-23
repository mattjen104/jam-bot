import { describe, expect, it } from "vitest";
import { archiveUrl, buildOverlap, countArchivePage, gatherTaste, normalizeArtist, searchArchive } from "../src/lore/lma-overlap.js";

const doc = (id: string, creator = "Grateful Dead", collection: string[] = ["etree", "GratefulDead"]) => ({
  identifier: id, creator, collection, mediatype: "etree", format: ["VBR MP3"],
});
const response = (docs: unknown[], numFound = docs.length) =>
  ({ ok: true, json: async () => ({ response: { docs, numFound } }) }) as Response;

describe("LMA taste and archive overlap", () => {
  it("separates committed from evaluation-only and drops passed-only, blank, and deselected inputs", () => {
    const artists = gatherTaste([
      { name: " Grateful Dead ", artistMbid: "id", source: "shelf" },
      { name: "grateful dead", source: "unresolved" },
      { name: "Phish", source: "rotation" },
      { name: "Passed", source: "passed" },
      { name: "Unknown Artist", source: "track" },
    ]);
    expect(artists).toEqual([
      { name: "Grateful Dead", artistMbid: "id", committed: true, evaluation: true },
      { name: "Phish", artistMbid: null, committed: false, evaluation: true },
    ]);
    expect(gatherTaste([])).toEqual([]);
  });

  it("escapes archive syntax and accepts safe punctuation variants, not other namesakes", () => {
    expect(archiveUrl('X" OR collection:*')).toContain("collection%3Aetree");
    expect(normalizeArtist("Guns N’ Roses")).toBe(normalizeArtist("Guns N Roses"));
    const seen = new Set<string>();
    expect(countArchivePage("Grateful Dead", [
      doc("same"), doc("same"), doc("bad", "Grateful Dead", ["etree", "unrelated"]),
      doc("other", "Another Band"), { ...doc("not-audio"), format: ["Text"] },
    ], seen)).toBe(true);
    expect([...seen]).toEqual(["same"]);
  });

  it("pages, deduplicates concerts, and marks capped searches partial", async () => {
    let calls = 0;
    const result = await searchArchive("Paging Test Artist", async () => {
      calls++;
      return response([{
        identifier: calls === 2 ? "second" : "same",
        creator: "Paging Test Artist", collection: ["etree", "PagingTestArtist"],
        mediatype: "etree", format: ["Flac"],
      }], 999);
    });
    expect(calls).toBe(3);
    expect(result).toMatchObject({ status: "matched", concerts: 2, truncated: true });
  });

  it("distinguishes an unavailable search and an uncertain namesake from a true zero", async () => {
    const failed = await searchArchive("Unavailable One", async () => { throw Error("timeout"); });
    expect(failed.status).toBe("unavailable");
    expect(failed.truncated).toBe(true);
    const uncertain = await searchArchive("Uncertain One", async () =>
      response([{ ...doc("one", "Uncertain One", ["etree", "differentArtist"]) }]));
    expect(uncertain.status).toBe("uncertain");
    expect(uncertain.concerts).toBe(0);
  });

  it("counts distinct identifiers across artists, with committed items taking precedence", async () => {
    const report = await buildOverlap(gatherTaste([
      { name: "A Band", source: "track" }, { name: "B Band", source: "inbox" },
    ]), async (name) => ({
      status: "matched", concerts: 2, truncated: false,
      identifiers: name === "A Band" ? ["shared", "a"] : ["shared", "b"],
      checkedAt: new Date().toISOString(),
    }));
    expect(report).toMatchObject({ concerts: 2, evaluationConcerts: 1, matchedArtists: 2, partial: false });
    expect(report.artists[0]).not.toHaveProperty("identifiers");
  });
});