import { describe, it, expect } from "vitest";
import {
  CURATED_BOOK_SOURCES,
  textIsOriginalSummary,
  BOOK_SOURCE_HANDLE,
} from "../src/lore/book-knowledge.js";

// Pure (no-DB) tests for the book-backed knowledge layer: the curated
// catalogue's invariants and the original-summary guard. DB-backed ingestion
// behaviour is covered in book-knowledge-db.test.ts.

describe("textIsOriginalSummary", () => {
  it("accepts a short original paraphrase", () => {
    expect(
      textIsOriginalSummary(
        "The song was assembled from separate takes recorded months apart.",
      ),
    ).toBe(true);
  });

  it("rejects empty and whitespace-only text", () => {
    expect(textIsOriginalSummary("")).toBe(false);
    expect(textIsOriginalSummary("   ")).toBe(false);
  });

  it("rejects chapter-length text (over 600 chars)", () => {
    expect(textIsOriginalSummary("a".repeat(601))).toBe(false);
  });

  it("rejects a long block wrapped entirely in quotation marks (verbatim excerpt shape)", () => {
    const longQuote = `"${"word ".repeat(50).trim()}"`;
    expect(longQuote.length).toBeGreaterThan(200);
    expect(textIsOriginalSummary(longQuote)).toBe(false);

    const curly = `\u201c${"word ".repeat(50).trim()}\u201d`;
    expect(textIsOriginalSummary(curly)).toBe(false);
  });

  it("allows short quoted song titles inside a summary", () => {
    expect(
      textIsOriginalSummary(
        '"The Chain" is the only Rumours song credited to all five members.',
      ),
    ).toBe(true);
  });
});

describe("CURATED_BOOK_SOURCES catalogue invariants", () => {
  it("book slugs are unique", () => {
    const slugs = CURATED_BOOK_SOURCES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every source has a title, author, and https landing URL", () => {
    for (const source of CURATED_BOOK_SOURCES) {
      expect(source.title.length).toBeGreaterThan(0);
      expect(source.author.length).toBeGreaterThan(0);
      // The curated catalogue always ships with a grounding link; the null
      // branch exists for degradation, not for curated entries.
      expect(source.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("every curated fact passes the original-summary guard", () => {
    for (const source of CURATED_BOOK_SOURCES) {
      for (const fact of source.facts) {
        expect(textIsOriginalSummary(fact.text), `${source.slug}: ${fact.text.slice(0, 40)}`).toBe(true);
      }
    }
  });

  it("every fact has a valid coverage level, status, and uuid-shaped MBID", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const source of CURATED_BOOK_SOURCES) {
      for (const fact of source.facts) {
        expect(["artist", "album", "recording"]).toContain(fact.coverageLevel);
        expect(["published", "draft"]).toContain(fact.status);
        expect(fact.mbid, `${source.slug} has placeholder MBID`).toMatch(uuid);
      }
    }
  });

  it("catalogue includes both recording-level and album-level facts", () => {
    const levels = new Set(
      CURATED_BOOK_SOURCES.flatMap((s) => s.facts.map((f) => f.coverageLevel)),
    );
    expect(levels.has("recording")).toBe(true);
    expect(levels.has("album")).toBe(true);
  });

  it("externalIds derived from the catalogue are deterministic and unique", () => {
    const ids = CURATED_BOOK_SOURCES.flatMap((s) =>
      s.facts.map((_, i) => `${BOOK_SOURCE_HANDLE}:${s.slug}:${i}`),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
