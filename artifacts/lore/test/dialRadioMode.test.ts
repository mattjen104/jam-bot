// @vitest-environment jsdom
/**
 * dialRadioMode — the /radio "blank radio" mode flag: parsing and
 * local-first persistence under its own key (lore:radioMode), separate
 * from lore:dialLens so existing lens state is never disturbed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { parseRadioMode, readRadioMode, writeRadioMode } from "../src/lib/dialRadioMode";
import { readDialLens, writeDialLens } from "../src/lib/dialLensState";

describe("parseRadioMode", () => {
  it("returns true only for the exact 'true' value", () => {
    expect(parseRadioMode("true")).toBe(true);
  });

  it("falls back to false for anything else", () => {
    expect(parseRadioMode("false")).toBe(false);
    expect(parseRadioMode(null)).toBe(false);
    expect(parseRadioMode(undefined)).toBe(false);
    expect(parseRadioMode("")).toBe(false);
    expect(parseRadioMode("TRUE")).toBe(false); // exact match only
    expect(parseRadioMode("1")).toBe(false);
    expect(parseRadioMode("garbage{{{")).toBe(false);
  });
});

describe("read/write round trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false with no stored value", () => {
    expect(readRadioMode()).toBe(false);
  });

  it("persists true across reads (reload survival)", () => {
    writeRadioMode(true);
    expect(readRadioMode()).toBe(true);
    expect(localStorage.getItem("lore:radioMode")).toBe("true");
  });

  it("switching back to crossings persists too", () => {
    writeRadioMode(true);
    writeRadioMode(false);
    expect(readRadioMode()).toBe(false);
    expect(localStorage.getItem("lore:radioMode")).toBe("false");
  });

  it("a corrupted stored value can never force the blank-radio mode", () => {
    localStorage.setItem("lore:radioMode", "!!corrupt!!");
    expect(readRadioMode()).toBe(false);
  });

  it("lives under its own key and never disturbs the lens state", () => {
    writeDialLens("press");
    writeRadioMode(true);
    expect(readDialLens()).toBe("press");
    expect(readRadioMode()).toBe(true);
    writeRadioMode(false);
    expect(readDialLens()).toBe("press");
  });
});
