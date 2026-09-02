import { describe, expect, it } from "vitest";
import { parseAcrResponse, signAcrRequest } from "../src/lore/apple-music-jam-fingerprint.js";

describe("Apple Music jam fingerprint adapter", () => {
  it("signs deterministic ACRCloud requests", () => {
    expect(signAcrRequest({ accessKey: "key", accessSecret: "secret", timestamp: 1_700_000_000 }))
      .toBe(signAcrRequest({ accessKey: "key", accessSecret: "secret", timestamp: 1_700_000_000 }));
  });

  it("prefers ISRC identity and preserves the needle offset", () => {
    expect(parseAcrResponse({
      status: { code: 0 },
      metadata: { music: [{
        acrid: "acr",
        title: "Track",
        artists: [{ name: "Artist" }],
        external_ids: { isrc: "USABC123" },
        play_offset_ms: 12_345,
        score: 91,
      }] },
    })).toEqual({
      key: "isrc:USABC123",
      title: "Track",
      artist: "Artist",
      isrc: "USABC123",
      playOffsetMs: 12_345,
      score: 91,
    });
  });

  it("returns null for explicit no-result responses", () => {
    expect(parseAcrResponse({ status: { code: 1001 } })).toBeNull();
  });
});