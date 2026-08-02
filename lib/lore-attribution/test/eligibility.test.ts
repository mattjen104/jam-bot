import { describe, expect, it } from "vitest";
import { eligibleDjName, normalizeAttributionName } from "../src/index.js";

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