/**
 * Station curation — pure unit tests (no real DB).
 *
 * Covers:
 *   - Rediscovery protection via RADIO_BROWSER_NAME_BLOCKLIST
 *   - filterStations blocklist enforcement
 *
 * DB-backed tests live in station-curation-db.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  RADIO_BROWSER_NAME_BLOCKLIST,
  filterStations,
  type RadioBrowserStation,
} from "../src/lore/radio-browser.js";

function makeStation(overrides: Partial<RadioBrowserStation> = {}): RadioBrowserStation {
  return {
    stationuuid: "uuid-blocklist",
    name: "Test Station",
    url_resolved: "https://stream.example.com/live",
    url: "https://stream.example.com/live",
    tags: "ambient",
    country: "US",
    homepage: "",
    favicon: "",
    codec: "MP3",
    bitrate: 128,
    votes: 200,
    clickcount: 100,
    lastcheckok: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rediscovery protection — RADIO_BROWSER_NAME_BLOCKLIST
// ---------------------------------------------------------------------------

describe("RADIO_BROWSER_NAME_BLOCKLIST — rediscovery prevention", () => {
  it("RADIO_BROWSER_NAME_BLOCKLIST is non-empty", () => {
    expect(RADIO_BROWSER_NAME_BLOCKLIST.length).toBeGreaterThan(0);
  });

  it("filterStations blocks stations matching a blocklist entry", () => {
    const blocked = filterStations([makeStation({ name: "Epic Lounge Radio" })]);
    expect(blocked).toHaveLength(0);
  });

  it("filterStations blocks 'Exclusively X' stations (prefix match)", () => {
    const blocked = filterStations([makeStation({ name: "Exclusively Beethoven" })]);
    expect(blocked).toHaveLength(0);
  });

  it("filterStations case-insensitively blocks matching names", () => {
    const blocked = filterStations([makeStation({ name: "EPIC LOUNGE" })]);
    expect(blocked).toHaveLength(0);
  });

  it("filterStations allows legitimate stations not matching any blocklist entry", () => {
    const allowed = filterStations([makeStation({ name: "KEXP Community Radio" })]);
    expect(allowed).toHaveLength(1);
  });
});
