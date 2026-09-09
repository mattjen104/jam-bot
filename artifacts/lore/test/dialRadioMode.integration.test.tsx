// Retired UI: unified-feed row assertions were removed; radio-mode persistence remains current.
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { parseRadioMode, readRadioMode, writeRadioMode } from "../src/lib/dialRadioMode";

afterEach(() => localStorage.clear());

describe("Dial radio mode persistence", () => {
  it("defaults malformed or absent state to all-stations radio mode", () => {
    expect(parseRadioMode(null)).toBe(true);
    expect(parseRadioMode("broken")).toBe(true);
  });

  it("honors and persists crossings mode", () => {
    writeRadioMode(false);
    expect(readRadioMode()).toBe(false);
    expect(localStorage.getItem("lore:radioMode")).toBe("false");
  });

  it("persists all-stations radio mode", () => {
    writeRadioMode(true);
    expect(readRadioMode()).toBe(true);
    expect(localStorage.getItem("lore:radioMode")).toBe("true");
  });
});