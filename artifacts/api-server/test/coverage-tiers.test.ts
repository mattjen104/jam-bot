import { describe, it, expect } from "vitest";
import { msUntilNextBoundaryPoll, coverageClassFor } from "../src/lore/poller.js";
import type { Station } from "@workspace/db";

function fakeStation(overrides: Partial<Station>): Station {
  return {
    id: 1,
    slug: "test",
    name: "Test",
    nowPlayingSource: null,
    nowPlayingConfig: null,
    hidden: false,
    favorite: false,
    ...overrides,
  } as Station;
}

describe("msUntilNextBoundaryPoll", () => {
  const HALF_HOUR = 30 * 60 * 1000;
  const OFFSET = 120_000;

  it("targets :02 when just past the hour", () => {
    // 10:00:30 → 90s to 10:02
    const now = Date.UTC(2026, 0, 1, 10, 0, 30);
    expect(msUntilNextBoundaryPoll(now, OFFSET)).toBe(90_000);
  });

  it("targets the NEXT boundary when inside the offset window", () => {
    // exactly 10:02 → next fire is 10:32
    const now = Date.UTC(2026, 0, 1, 10, 2, 0);
    expect(msUntilNextBoundaryPoll(now, OFFSET)).toBe(HALF_HOUR);
  });

  it("targets :32 when mid half-hour", () => {
    const now = Date.UTC(2026, 0, 1, 10, 15, 0);
    expect(msUntilNextBoundaryPoll(now, OFFSET)).toBe(17 * 60 * 1000);
  });

  it("always returns a positive delay", () => {
    for (const min of [0, 1, 2, 15, 29, 30, 31, 45, 59]) {
      const d = msUntilNextBoundaryPoll(Date.UTC(2026, 0, 1, 9, min, 17), OFFSET);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(HALF_HOUR + OFFSET);
    }
  });
});

describe("coverageClassFor", () => {
  it("classifies history-paging sources as complete-history", () => {
    for (const source of ["spinitron", "kexp_api", "bbc_api", "somafm"]) {
      expect(coverageClassFor(fakeStation({ nowPlayingSource: source }))).toBe(
        "complete-history",
      );
    }
  });

  it("classifies kcrw (single current track, no depth) as blind-spot", () => {
    expect(coverageClassFor(fakeStation({ nowPlayingSource: "kcrw" }))).toBe(
      "blind-spot",
    );
  });

  it("classifies now-playing-only sources without a connection as blind-spot", () => {
    for (const source of [
      "fip",
      "radio_paradise",
      "station_page",
      "radiojar",
      "radio_browser_icy",
      "spinitron_web",
    ]) {
      expect(coverageClassFor(fakeStation({ nowPlayingSource: source }))).toBe(
        "blind-spot",
      );
    }
  });
});
