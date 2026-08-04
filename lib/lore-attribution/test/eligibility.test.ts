import { describe, expect, it } from "vitest";
import { eligibleDjName, eligibleDjNames, normalizeAttributionName } from "../src/index.js";

describe("DJ attribution eligibility", () => {
  it("normalizes case, punctuation, accents, spacing, and invisible characters for comparisons", () => {
    expect(normalizeAttributionName("  Björk\u200B— Guðmundsdóttir! ")).toBe("bjork guðmundsdottir");
    expect(eligibleDjName("Björk — Guðmundsdóttir", { artist: "bjork guðmundsdottir" })).toBeNull();
  });

  it.each(["Unknown", "Automation", "Station ID", "Now Playing", "artist.mp3"])(
    "rejects generic metadata: %s",
    (value) => {
      expect(eligibleDjName(value)).toBeNull();
    },
  );

  it("rejects collisions with the live artist, track, show, and station", () => {
    const context = {
      artist: "The Artist",
      title: "The Track",
      showTitle: "The Show",
      stationName: "Test FM",
    };
    for (const value of ["the artist", "THE TRACK!", " the show ", "Test—FM"]) {
      expect(eligibleDjName(value, context)).toBeNull();
    }
  });

  it("keeps real multi-word hosts, multi-host credits, and aliases when no live collision exists", () => {
    expect(eligibleDjName("Diane Kamikaze", { artist: "Deftones", title: "Change" })).toBe("Diane Kamikaze");
    expect(eligibleDjName("Alice, Bob", { showTitle: "Late Night" })).toBe("Alice, Bob");
    expect(eligibleDjName("Wizzy", { artist: "Portishead", title: "Glory Box" })).toBe("Wizzy");
  });
});

describe("eligibleDjNames — multi-DJ cascade", () => {
  it("returns a single-element array for a show with one eligible djName", () => {
    expect(eligibleDjNames({ name: "Morning Mix", djName: "Tom Schnabel" })).toEqual(["Tom Schnabel"]);
  });

  it("falls back to djName when djNames is absent", () => {
    expect(eligibleDjNames({ name: "Morning Mix", djName: "Alice" })).toEqual(["Alice"]);
  });

  it("uses djNames when present, ignoring djName", () => {
    const show = { name: "Late Show", djName: "Alice", djNames: ["Alice", "Bob"] };
    expect(eligibleDjNames(show)).toEqual(["Alice", "Bob"]);
  });

  it("returns empty array when the single djName is generic/ineligible", () => {
    expect(eligibleDjNames({ name: "Overnight", djName: "Automation" })).toEqual([]);
  });

  it("returns empty array when all djNames are generic/ineligible", () => {
    const show = { name: "Night Shift", djNames: ["Automation", "Unknown DJ"] };
    expect(eligibleDjNames(show)).toEqual([]);
  });

  it("deduplicates matching DJ names (two identical names → single entry)", () => {
    const show = { name: "Double Billing", djNames: ["Alice", "Alice"] };
    expect(eligibleDjNames(show)).toEqual(["Alice"]);
  });

  it("deduplicates case-insensitively (Alice vs ALICE → single entry)", () => {
    const show = { name: "Double Billing", djNames: ["Alice", "ALICE"] };
    expect(eligibleDjNames(show)).toHaveLength(1);
  });

  it("returns two entries for two distinct eligible DJ names (ambiguous multi-DJ)", () => {
    const show = { name: "Co-Hosted", djNames: ["Alice", "Bob"] };
    expect(eligibleDjNames(show)).toEqual(["Alice", "Bob"]);
  });

  it("filters ineligible names from a mixed list, leaving eligible ones", () => {
    const show = { name: "Mixed", djNames: ["Alice", "Automation", "Bob"] };
    expect(eligibleDjNames(show)).toEqual(["Alice", "Bob"]);
  });

  it("honours context: suppresses a DJ name that matches the live artist", () => {
    const show = { name: "Live Show", djNames: ["Portishead", "Alice"] };
    const ctx = { artist: "Portishead" };
    // "Portishead" collides with the artist — only "Alice" survives
    expect(eligibleDjNames(show, ctx)).toEqual(["Alice"]);
  });

  it("returns empty array when djName is absent and djNames is empty", () => {
    expect(eligibleDjNames({ name: "Untitled" })).toEqual([]);
  });
});