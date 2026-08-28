// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shouldShowPressMatch } from "../src/components/HomePress";

describe("shouldShowPressMatch", () => {
  it("hides extracted details already present in the headline", () => {
    expect(shouldShowPressMatch({
      title: "THAO – “Catch As Catch Can” (Feat. Neko Case)",
      matchedArtist: "THAO",
      matchedWork: "“Catch As Catch Can”",
    })).toBe(false);
  });

  it("hides an artist-only match already present in the headline", () => {
    expect(shouldShowPressMatch({
      title: "Russian Circles - Nine",
      matchedArtist: "Russian Circles",
      matchedWork: null,
    })).toBe(false);
  });

  it("keeps match context when the headline does not identify the artist", () => {
    expect(shouldShowPressMatch({
      title: "The best albums arriving this month",
      matchedArtist: "Russian Circles",
      matchedWork: "Nine",
    })).toBe(true);
  });

  it("keeps a work label when only the artist is in the headline", () => {
    expect(shouldShowPressMatch({
      title: "Russian Circles announce a new record",
      matchedArtist: "Russian Circles",
      matchedWork: "Nine",
    })).toBe(true);
  });
});