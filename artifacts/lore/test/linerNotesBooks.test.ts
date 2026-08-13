/**
 * Tests for buildLinerGroups book handling — book-backed claims render as a
 * distinct BOOKS section with title/author context, published-only gating,
 * and honest degradation when the book link is unavailable.
 */
import { describe, expect, it } from "vitest";
import { buildLinerGroups } from "../src/lib/linerNotes";
import type { TrackClaim } from "@workspace/api-client-react";

function makeClaim(overrides: Partial<TrackClaim> = {}): TrackClaim {
  return {
    id: 1,
    text: "A short original summary.",
    sourceLabel: "Some Source",
    sourceHandle: "song-exploder",
    sourceUrl: "https://example.com/source",
    status: "published",
    ...overrides,
  };
}

describe("buildLinerGroups — BOOKS section", () => {
  it("published book claims render in their own BOOKS section, apart from CLAIMS", () => {
    const groups = buildLinerGroups(null, [
      makeClaim({ sourceHandle: "song-exploder", text: "Podcast fact." }),
      makeClaim({
        sourceHandle: "book",
        sourceLabel: "Making Rumours — Ken Caillat & Steven Stiefel",
        sourceUrl: "https://www.worldcat.org/title/making-rumours",
        text: "The bassline came from an abandoned outtake.",
      }),
    ]);

    const labels = groups.map((g) => g.label);
    expect(labels).toContain("CLAIMS");
    expect(labels).toContain("BOOKS");

    const books = groups.find((g) => g.label === "BOOKS")!;
    expect(books.rows).toHaveLength(1);
    expect(books.rows[0]!.text).toContain("abandoned outtake");
    // Title/author context travels with the row chip.
    expect(books.rows[0]!.sourceLabel).toBe(
      "Making Rumours — Ken Caillat & Steven Stiefel",
    );
    expect(books.rows[0]!.sourceUrl).toBe(
      "https://www.worldcat.org/title/making-rumours",
    );

    const claims = groups.find((g) => g.label === "CLAIMS")!;
    expect(claims.rows).toHaveLength(1);
    expect(claims.rows[0]!.text).toBe("Podcast fact.");
  });

  it("draft book claims are never rendered", () => {
    const groups = buildLinerGroups(null, [
      makeClaim({ sourceHandle: "book", status: "draft" }),
    ]);
    expect(groups.find((g) => g.label === "BOOKS")).toBeUndefined();
  });

  it("book claim with an empty link renders without a sourceUrl (no dead link)", () => {
    const groups = buildLinerGroups(null, [
      makeClaim({
        sourceHandle: "book",
        sourceLabel: "Chronicles: Volume One — Bob Dylan",
        sourceUrl: "",
      }),
    ]);
    const books = groups.find((g) => g.label === "BOOKS")!;
    expect(books.rows[0]!.sourceUrl).toBeUndefined();
  });

  it("book-only claims produce a BOOKS section and no CLAIMS section", () => {
    const groups = buildLinerGroups(null, [
      makeClaim({
        sourceHandle: "book",
        sourceLabel: "Pigs Might Fly — Mark Blake",
      }),
    ]);
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("BOOKS");
    expect(labels).not.toContain("CLAIMS");
  });
});
