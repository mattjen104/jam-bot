// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  SECTION_MEMORY_STORAGE_KEY,
  readSectionMemory,
  writeLibrarySectionMemory,
  writeSelectorSectionMemory,
} from "../src/player/sectionMemory";

const seed = {
  mbid: "recording-1",
  title: "A Song",
  artist: "An Artist",
  artworkUrl: "https://images.example/a.jpg",
  links: [],
};

describe("record-peek section memory", () => {
  beforeEach(() => localStorage.clear());

  it("discards malformed, unsupported, and invalid persisted records", () => {
    localStorage.setItem(SECTION_MEMORY_STORAGE_KEY, "{not json");
    expect(readSectionMemory()).toMatchObject({ version: 1, radio: null, selectors: null, library: null });

    localStorage.setItem(SECTION_MEMORY_STORAGE_KEY, JSON.stringify({
      version: 99,
      radio: { station: { slug: "old" } },
    }));
    expect(readSectionMemory().radio).toBeNull();

    localStorage.setItem(SECTION_MEMORY_STORAGE_KEY, JSON.stringify({
      version: 1,
      selectors: { label: "Bad queue", queue: [seed], orientation: "past", index: 8 },
    }));
    expect(readSectionMemory().selectors).toBeNull();
  });

  it("hydrates a bounded selector run and preserves its resume index", () => {
    writeSelectorSectionMemory([seed, { ...seed, mbid: "recording-2", title: "Second" }], "Night Shift", "past", 1);
    expect(readSectionMemory().selectors).toEqual({
      kind: "selectors",
      label: "Night Shift",
      orientation: "past",
      index: 1,
      queue: [seed, { ...seed, mbid: "recording-2", title: "Second" }],
    });
  });

  it("retains an explicit Library listen over the kept-song fallback", () => {
    writeLibrarySectionMemory(seed, {
      mbid: "release-1",
      title: "The Album",
      artworkUrl: seed.artworkUrl,
    }, seed.mbid);
    expect(readSectionMemory().library).toMatchObject({
      fallback: false,
      album: { title: "The Album" },
      track: { mbid: seed.mbid },
    });
  });
});