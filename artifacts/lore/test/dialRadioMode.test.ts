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
  it("returns false only for the exact 'false' value (crossings explicitly on)", () => {
    expect(parseRadioMode("false")).toBe(false);
  });

  it("falls back to true (radio mode) for anything else — the default", () => {
    expect(parseRadioMode("true")).toBe(true);
    expect(parseRadioMode(null)).toBe(true);
    expect(parseRadioMode(undefined)).toBe(true);
    expect(parseRadioMode("")).toBe(true);
    expect(parseRadioMode("TRUE")).toBe(true); // exact match only
    expect(parseRadioMode("1")).toBe(true);
    expect(parseRadioMode("garbage{{{")).toBe(true);
  });
});

describe("read/write round trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to radio mode with no stored value", () => {
    expect(readRadioMode()).toBe(true);
  });

  it("persists true across reads (reload survival)", () => {
    writeRadioMode(true);
    expect(readRadioMode()).toBe(true);
    expect(localStorage.getItem("lore:radioMode")).toBe("true");
  });

  it("switching to crossings persists too", () => {
    writeRadioMode(false);
    expect(readRadioMode()).toBe(false);
    expect(localStorage.getItem("lore:radioMode")).toBe("false");
  });

  it("a corrupted stored value falls back to the default radio mode", () => {
    localStorage.setItem("lore:radioMode", "!!corrupt!!");
    expect(readRadioMode()).toBe(true);
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
