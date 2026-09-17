// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildVisibleStationArtworkCsv,
  VISIBLE_STATION_ARTWORK_HEADERS,
  type VisibleStationArtworkRow,
} from "../../src/scripts/generate-visible-station-artwork-report.js";

function row(overrides: Partial<VisibleStationArtworkRow> = {}): VisibleStationArtworkRow {
  return {
    name: "Station",
    slug: "station",
    homepage_url: "https://station.example",
    logo_url: null,
    logo_source: "website",
    logo_width: 1200,
    logo_height: 800,
    station_icon_url: null,
    station_icon_source: "radio_browser",
    station_icon_width: 64,
    station_icon_height: 64,
    logo_checked_at: null,
    logo_check_state: "never_checked",
    station_icon_checked_at: null,
    station_icon_check_state: "never_checked",
    ...overrides,
  };
}

describe("visible station artwork report CSV", () => {
  it("keeps the complete operator-facing header and preserves every provenance/dimension column", () => {
    const result = buildVisibleStationArtworkCsv([
      row({
        name: "KEXP, Seattle",
        homepage_url: "https://example.test/home\nschedule",
        logo_url: 'https://example.test/logo-"wide".png',
        logo_source: "curated",
        logo_width: 2400,
        logo_height: 1350,
        logo_checked_at: "2026-01-01T00:00:00.000Z",
        logo_check_state: "checked_missing",
        station_icon_url: "https://example.test/icon.png",
        station_icon_source: "website",
        station_icon_width: 96,
        station_icon_height: 96,
        station_icon_checked_at: "2026-01-02T00:00:00.000Z",
        station_icon_check_state: "present",
      }),
    ]);

    expect(result).toBe(
      [
        VISIBLE_STATION_ARTWORK_HEADERS.join(","),
        '"KEXP, Seattle",station,"https://example.test/home\nschedule","https://example.test/logo-""wide"".png",curated,2400,1350,2026-01-01T00:00:00.000Z,checked_missing,https://example.test/icon.png,website,96,96,2026-01-02T00:00:00.000Z,present',
        "",
      ].join("\n"),
    );
  });

  it("escapes commas, quotes, and newlines and renders null as an empty field", () => {
    const result = buildVisibleStationArtworkCsv([
      row({
        name: 'A "quoted", station',
        homepage_url: null,
        logo_source: null,
        station_icon_source: null,
        logo_checked_at: null,
        logo_check_state: "never_checked",
        station_icon_checked_at: null,
        station_icon_check_state: "never_checked",
      }),
    ]);

    expect(result).toContain('"A ""quoted"", station"');
    expect(result.split("\n")[1]).toBe(
      '"A ""quoted"", station",station,,,,1200,800,,never_checked,,,64,64,,never_checked',
    );
  });

  it("rejects a row with an invalid column shape before producing CSV", () => {
    const invalid = {
      ...row(),
      unexpected: "changed query",
    } as VisibleStationArtworkRow;

    expect(() => buildVisibleStationArtworkCsv([invalid])).toThrow(
      "visible station artwork row has invalid columns",
    );
  });
});