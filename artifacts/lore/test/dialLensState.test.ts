// @vitest-environment jsdom
/**
 * dialLensState — lens parsing and local-first persistence.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { parseDialLens, readDialLens, writeDialLens, DIAL_LENSES } from "../src/lib/dialLensState";

describe("parseDialLens", () => {
  it("returns press only for the exact 'press' value", () => {
    expect(parseDialLens("press")).toBe("press");
  });

  it("falls back to radio for anything else", () => {
    expect(parseDialLens("radio")).toBe("radio");
    expect(parseDialLens(null)).toBe("radio");
    expect(parseDialLens(undefined)).toBe("radio");
    expect(parseDialLens("")).toBe("radio");
    expect(parseDialLens("shows")).toBe("radio"); // future lens value stays safe today
    expect(parseDialLens("PRESS")).toBe("radio"); // exact match only
    expect(parseDialLens("garbage{{{")).toBe("radio");
  });
});

describe("read/write round trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to radio with no stored value", () => {
    expect(readDialLens()).toBe("radio");
  });

  it("persists press across reads (reload survival)", () => {
    writeDialLens("press");
    expect(readDialLens()).toBe("press");
    expect(localStorage.getItem("lore:dialLens")).toBe("press");
  });

  it("switching back to radio persists too", () => {
    writeDialLens("press");
    writeDialLens("radio");
    expect(readDialLens()).toBe("radio");
  });

  it("a corrupted stored value can never blank the dial", () => {
    localStorage.setItem("lore:dialLens", "!!corrupt!!");
    expect(readDialLens()).toBe("radio");
  });
});

describe("DIAL_LENSES", () => {
  it("lists radio first (the default) then press", () => {
    expect(DIAL_LENSES).toEqual(["radio", "press"]);
  });
});
