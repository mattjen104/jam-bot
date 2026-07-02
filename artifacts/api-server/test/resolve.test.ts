import { describe, it, expect } from "vitest";
import { normalizeKey, durationMismatch } from "../src/lore/resolve.js";

describe("normalizeKey", () => {
  it("is case- and punctuation-insensitive", () => {
    expect(normalizeKey("The Beatles", "Hey Jude")).toBe(
      normalizeKey("the beatles!!", "  hey   jude  "),
    );
  });

  it("strips diacritics so accented spellings collide", () => {
    expect(normalizeKey("Beyoncé", "Déjà Vu")).toBe(
      normalizeKey("Beyonce", "Deja Vu"),
    );
  });

  it("separates artist and title so a differently-split pair cannot collide", () => {
    // "The Beatles" / "Hey Jude" must NOT equal "The" / "Beatles Hey Jude".
    expect(normalizeKey("The Beatles", "Hey Jude")).not.toBe(
      normalizeKey("The", "Beatles Hey Jude"),
    );
  });

  it("distinguishes different tracks", () => {
    expect(normalizeKey("Radiohead", "Creep")).not.toBe(
      normalizeKey("Radiohead", "Karma Police"),
    );
  });
});

describe("durationMismatch", () => {
  it("is false when either duration is missing (absence is not evidence)", () => {
    expect(durationMismatch(undefined, 200_000)).toBe(false);
    expect(durationMismatch(200_000, undefined)).toBe(false);
    expect(durationMismatch(undefined, undefined)).toBe(false);
  });

  it("is false for a normal edit/remaster difference", () => {
    expect(durationMismatch(200_000, 210_000)).toBe(false);
  });

  it("is true only for a gross clip-vs-full mismatch", () => {
    expect(durationMismatch(30_000, 480_000)).toBe(true);
  });

  it("ignores non-positive durations", () => {
    expect(durationMismatch(0, 480_000)).toBe(false);
    expect(durationMismatch(480_000, -1)).toBe(false);
  });

  it("respects the tolerance boundary", () => {
    expect(durationMismatch(100_000, 220_001)).toBe(true);
    expect(durationMismatch(100_000, 220_000)).toBe(false);
  });
});
