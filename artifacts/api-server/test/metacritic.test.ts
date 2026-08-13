import { describe, it, expect } from "vitest";
import {
  metacriticSlug,
  stripLeadingArticle,
  metacriticCandidateUrls,
  extractLdJson,
  parseMetaScore,
  buildMetacriticClaimText,
} from "../src/lore/metacritic.js";

// ---------------------------------------------------------------------------
// metacriticSlug
// ---------------------------------------------------------------------------

describe("metacriticSlug", () => {
  it("lowercases and replaces non-alphanumeric with hyphens", () => {
    expect(metacriticSlug("Mellon Collie and the Infinite Sadness")).toBe(
      "mellon-collie-and-the-infinite-sadness",
    );
  });

  it("collapses runs of hyphens", () => {
    expect(metacriticSlug("OK -- Computer")).toBe("ok-computer");
  });

  it("strips leading and trailing hyphens", () => {
    expect(metacriticSlug("...And Justice for All")).toBe("and-justice-for-all");
  });

  it("handles numbers", () => {
    expect(metacriticSlug("1979")).toBe("1979");
  });

  it("handles an already-clean slug", () => {
    expect(metacriticSlug("radiohead")).toBe("radiohead");
  });
});

// ---------------------------------------------------------------------------
// stripLeadingArticle
// ---------------------------------------------------------------------------

describe("stripLeadingArticle", () => {
  it("strips 'The ' prefix (case-insensitive)", () => {
    expect(stripLeadingArticle("The Smashing Pumpkins")).toBe("Smashing Pumpkins");
    expect(stripLeadingArticle("THE NATIONAL")).toBe("NATIONAL");
  });

  it("strips 'A ' prefix", () => {
    expect(stripLeadingArticle("A Tribe Called Quest")).toBe("Tribe Called Quest");
  });

  it("strips 'An ' prefix", () => {
    expect(stripLeadingArticle("An Artist")).toBe("Artist");
  });

  it("leaves names without a leading article unchanged", () => {
    expect(stripLeadingArticle("Radiohead")).toBe("Radiohead");
    expect(stripLeadingArticle("Smashing Pumpkins")).toBe("Smashing Pumpkins");
  });

  it("does not strip 'the' embedded mid-word", () => {
    expect(stripLeadingArticle("Theatre of Pain")).toBe("Theatre of Pain");
  });
});

// ---------------------------------------------------------------------------
// metacriticCandidateUrls — Mellon Collie smoke-test
// ---------------------------------------------------------------------------

describe("metacriticCandidateUrls", () => {
  const BASE = "https://www.metacritic.com";

  it("includes the article-stripped B′ pattern for 'The Smashing Pumpkins'", () => {
    const urls = metacriticCandidateUrls(
      "The Smashing Pumpkins",
      "Mellon Collie and the Infinite Sadness",
    );
    // The canonical Metacritic URL for MCIS:
    expect(urls).toContain(
      `${BASE}/music/mellon-collie-and-the-infinite-sadness/smashing-pumpkins/`,
    );
  });

  it("also includes the full artist-slug Pattern B", () => {
    const urls = metacriticCandidateUrls(
      "The Smashing Pumpkins",
      "Mellon Collie and the Infinite Sadness",
    );
    expect(urls).toContain(
      `${BASE}/music/mellon-collie-and-the-infinite-sadness/the-smashing-pumpkins/`,
    );
  });

  it("always includes the article-less Pattern A", () => {
    const urls = metacriticCandidateUrls("Radiohead", "OK Computer");
    expect(urls).toContain(`${BASE}/music/ok-computer/`);
  });

  it("does NOT add a duplicate article-stripped entry when artist has no article", () => {
    const urls = metacriticCandidateUrls("Radiohead", "OK Computer");
    const bUrls = urls.filter((u) => u.includes("/ok-computer/radiohead"));
    // Only one B-pattern entry (no duplicate)
    expect(bUrls.length).toBe(1);
  });

  it("includes article-stripped Pattern C′ for 'The National'", () => {
    const urls = metacriticCandidateUrls("The National", "High Violet");
    expect(urls).toContain(`${BASE}/music/national-high-violet/`);
  });

  it("returns URLs in a useful try-order (Pattern A first)", () => {
    const urls = metacriticCandidateUrls("Radiohead", "Kid A");
    expect(urls[0]).toBe(`${BASE}/music/kid-a/`);
  });
});

// ---------------------------------------------------------------------------
// extractLdJson
// ---------------------------------------------------------------------------

describe("extractLdJson", () => {
  it("extracts the first valid ld+json block", () => {
    const html = `
      <html>
        <script type="application/ld+json">{"@type":"MusicAlbum","aggregateRating":{"ratingValue":93,"reviewCount":22}}</script>
      </html>`;
    const result = extractLdJson(html);
    expect(result).not.toBeNull();
    expect(result?.aggregateRating?.ratingValue).toBe(93);
    expect(result?.aggregateRating?.reviewCount).toBe(22);
  });

  it("tries subsequent blocks when the first is unparseable JSON", () => {
    const html = `
      <script type="application/ld+json">NOT JSON</script>
      <script type="application/ld+json">{"aggregateRating":{"ratingValue":88}}</script>`;
    const result = extractLdJson(html);
    expect(result?.aggregateRating?.ratingValue).toBe(88);
  });

  it("returns null when no ld+json block is present", () => {
    expect(extractLdJson("<html><body>no scripts</body></html>")).toBeNull();
  });

  it("returns null when all ld+json blocks are invalid JSON", () => {
    const html = `<script type="application/ld+json">BROKEN</script>`;
    expect(extractLdJson(html)).toBeNull();
  });

  it("handles single-quoted type attribute", () => {
    const html = `<script type='application/ld+json'>{"aggregateRating":{"ratingValue":75}}</script>`;
    expect(extractLdJson(html)?.aggregateRating?.ratingValue).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// parseMetaScore
// ---------------------------------------------------------------------------

describe("parseMetaScore", () => {
  it("parses numeric ratingValue and reviewCount", () => {
    const result = parseMetaScore({ aggregateRating: { ratingValue: 93, reviewCount: 22 } });
    expect(result).toEqual({ score: 93, reviewCount: 22 });
  });

  it("parses string ratingValue and reviewCount", () => {
    const result = parseMetaScore({ aggregateRating: { ratingValue: "88", reviewCount: "15" } });
    expect(result).toEqual({ score: 88, reviewCount: 15 });
  });

  it("falls back to ratingCount when reviewCount is absent", () => {
    const result = parseMetaScore({ aggregateRating: { ratingValue: 76, ratingCount: 10 } });
    expect(result).toEqual({ score: 76, reviewCount: 10 });
  });

  it("rounds non-integer scores", () => {
    const result = parseMetaScore({ aggregateRating: { ratingValue: 87.6, reviewCount: 5 } });
    expect(result?.score).toBe(88);
  });

  it("returns null when aggregateRating is absent", () => {
    expect(parseMetaScore({})).toBeNull();
  });

  it("returns null for scores outside 0–100", () => {
    expect(parseMetaScore({ aggregateRating: { ratingValue: 150, reviewCount: 5 } })).toBeNull();
    expect(parseMetaScore({ aggregateRating: { ratingValue: -1, reviewCount: 5 } })).toBeNull();
  });

  it("returns null when reviewCount is zero or absent", () => {
    expect(parseMetaScore({ aggregateRating: { ratingValue: 80, reviewCount: 0 } })).toBeNull();
    expect(parseMetaScore({ aggregateRating: { ratingValue: 80 } })).toBeNull();
  });

  it("returns null for non-numeric ratingValue", () => {
    expect(parseMetaScore({ aggregateRating: { ratingValue: "n/a", reviewCount: 5 } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildMetacriticClaimText
// ---------------------------------------------------------------------------

describe("buildMetacriticClaimText", () => {
  it("formats singular review count correctly", () => {
    expect(buildMetacriticClaimText(93, 1)).toBe("Metascore: 93/100 (1 critic review)");
  });

  it("formats plural review count correctly", () => {
    expect(buildMetacriticClaimText(93, 22)).toBe("Metascore: 93/100 (22 critic reviews)");
  });

  it("handles zero score edge case", () => {
    expect(buildMetacriticClaimText(0, 5)).toBe("Metascore: 0/100 (5 critic reviews)");
  });
});
