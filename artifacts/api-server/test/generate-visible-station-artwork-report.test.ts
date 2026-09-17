import {
  artworkCheckState,
  buildVisibleStationArtworkCsv,
  VISIBLE_STATION_ARTWORK_HEADERS,
  type VisibleStationArtworkRow,
} from "../src/scripts/generate-visible-station-artwork-report";
import { describe, expect, it } from "vitest";

describe("visible station artwork report", () => {
  it.each([
    [null, null, "never_checked"],
    ["", new Date("2026-01-01T00:00:00.000Z"), "checked_missing"],
    ["https://example.test/icon.svg", null, "present"],
  ] as const)("derives %s from URL and completion evidence", (url, checkedAt, expected) => {
    expect(artworkCheckState(url, checkedAt)).toBe(expected);
  });

  it("keeps role evidence and derived states in the CSV", () => {
    const row: VisibleStationArtworkRow = {
      name: "Example, FM",
      slug: "example-fm",
      homepage_url: "https://example.test",
      logo_url: null,
      logo_source: null,
      logo_width: null,
      logo_height: null,
      logo_checked_at: "2026-01-01T00:00:00.000Z",
      logo_check_state: "checked_missing",
      station_icon_url: "https://example.test/icon.svg",
      station_icon_source: "website",
      station_icon_width: 64,
      station_icon_height: 64,
      station_icon_checked_at: "2026-01-01T00:00:00.000Z",
      station_icon_check_state: "present",
    };

    const [header, values] = buildVisibleStationArtworkCsv([row])
      .trimEnd()
      .split("\n");

    expect(header).toBe(VISIBLE_STATION_ARTWORK_HEADERS.join(","));
    expect(values).toContain('"Example, FM"');
    expect(values).toContain("checked_missing");
    expect(values).toContain("present");
  });
});