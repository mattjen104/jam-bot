import { describe, expect, it } from "vitest";
import { DurationEvidenceCache } from "../src/lore/duration-evidence.js";

describe("DurationEvidenceCache", () => {
  it("does not release a text estimate from one observation", () => {
    const cache = new DurationEvidenceCache();
    cache.observeText("Artist", "Song", 180_000);
    expect(cache.estimate("artist", "song")).toBeNull();
  });

  it("releases repeated low-variance text evidence", () => {
    const cache = new DurationEvidenceCache();
    cache.observeText("Artist", "Song", 180_000);
    cache.observeText(" ARTIST ", "Song", 181_000);
    expect(cache.estimate("artist", "song")).toEqual({
      durationMs: 180_500,
      kind: "text",
      samples: 2,
    });
  });

  it("keeps conflicting edits ambiguous instead of averaging them", () => {
    const cache = new DurationEvidenceCache();
    cache.observeText("Artist", "Song", 180_000);
    cache.observeText("Artist", "Song", 240_000);
    cache.observeText("Artist", "Song", 181_000);
    expect(cache.estimate("Artist", "Song")).toBeNull();
  });

  it("prefers strong identifier evidence immediately", () => {
    const cache = new DurationEvidenceCache();
    cache.observeStrong("US-ABC-12-34567", 212_000, "isrc");
    expect(
      cache.estimate("Edited artist", "Edited title", [
        { key: "us-abc-12-34567", kind: "isrc" },
      ]),
    ).toEqual({ durationMs: 212_000, kind: "isrc", samples: 1 });
  });
});