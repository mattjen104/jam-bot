// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseHomeLens,
  readHomeLens,
  writeHomeLens,
} from "../src/lib/homeLensState";

vi.mock("../src/lib/dialLensState", () => ({
  readDialLens: vi.fn(() => "radio"),
  writeDialLens: vi.fn(),
}));

import { readDialLens, writeDialLens } from "../src/lib/dialLensState";

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("home lens state", () => {
  it("parses the home-only First plays lens and falls back to Radio", () => {
    expect(parseHomeLens("firstPlays")).toBe("firstPlays");
    expect(parseHomeLens("press")).toBe("press");
    expect(parseHomeLens("unknown")).toBe("radio");
  });

  it("migrates the existing Radio/Press preference when no home preference exists", () => {
    vi.mocked(readDialLens).mockReturnValue("press");
    expect(readHomeLens()).toBe("press");
    expect(localStorage.getItem("lore:homeLens")).toBeNull();
  });

  it("persists First plays without changing the full-feed lens", () => {
    writeHomeLens("firstPlays");
    expect(localStorage.getItem("lore:homeLens")).toBe("firstPlays");
    expect(writeDialLens).not.toHaveBeenCalled();
  });

  it("keeps Radio and Press synced with the existing full-feed preference", () => {
    writeHomeLens("press");
    expect(localStorage.getItem("lore:homeLens")).toBe("press");
    expect(writeDialLens).toHaveBeenCalledWith("press");
  });
});