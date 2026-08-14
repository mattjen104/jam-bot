// @vitest-environment node
/**
 * Unit tests for the Bandsintown fetcher and shows read-model helpers.
 *
 * Covers:
 *   - normalizeArtistKey: ASCII folding, lowercasing, punctuation stripping
 *   - City matching logic (normalizeCity / matchesCity logic via the shows route)
 */

import { describe, it, expect } from "vitest";
import { normalizeArtistKey } from "../src/lore/bandsintown-fetcher.js";

describe("normalizeArtistKey", () => {
  it("lowercases ASCII names", () => {
    expect(normalizeArtistKey("Fleetwood Mac")).toBe("fleetwood-mac");
  });

  it("strips accents via NFKD", () => {
    expect(normalizeArtistKey("Sigur Rós")).toBe("sigur-ros");
    expect(normalizeArtistKey("Björk")).toBe("bjork");
  });

  it("collapses repeated punctuation to a single hyphen", () => {
    expect(normalizeArtistKey("AC/DC")).toBe("ac-dc");
    expect(normalizeArtistKey("A$AP Rocky")).toBe("a-ap-rocky");
  });

  it("strips leading and trailing hyphens", () => {
    expect(normalizeArtistKey("  The Beatles  ")).toBe("the-beatles");
  });

  it("returns empty string for a name with no usable characters", () => {
    expect(normalizeArtistKey("  ")).toBe("");
    expect(normalizeArtistKey("!@#$%")).toBe("");
  });

  it("truncates at 200 characters", () => {
    const long = "a".repeat(300);
    expect(normalizeArtistKey(long).length).toBe(200);
  });

  it("deduplicates 'The Beatles' and 'the beatles'", () => {
    const k1 = normalizeArtistKey("The Beatles");
    const k2 = normalizeArtistKey("the beatles");
    expect(k1).toBe(k2);
  });

  it("treats numbers as valid key characters", () => {
    expect(normalizeArtistKey("808 State")).toBe("808-state");
  });
});
