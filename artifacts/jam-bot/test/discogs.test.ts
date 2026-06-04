import { describe, it, expect } from "vitest";
import { parseDiscogsSearch } from "../src/turntable/discogs.js";

describe("Discogs search parsing", () => {
  it("extracts label/year/country/format from the top release", () => {
    const pressing = parseDiscogsSearch({
      results: [
        {
          year: "1959",
          country: "US",
          label: ["Columbia", "Columbia"],
          format: ["Vinyl", "LP", "Album"],
        },
        { year: "1997", label: ["Reissue Label"] },
      ],
    });
    expect(pressing).toEqual({
      label: "Columbia",
      year: 1959,
      country: "US",
      format: "Vinyl, LP, Album",
    });
  });

  it("accepts a numeric year and partial fields", () => {
    expect(parseDiscogsSearch({ results: [{ year: 1971, label: ["Island"] }] }))
      .toEqual({
        label: "Island",
        year: 1971,
        country: undefined,
        format: undefined,
      });
  });

  it("returns null on no results or an all-empty top result", () => {
    expect(parseDiscogsSearch({ results: [] })).toBeNull();
    expect(parseDiscogsSearch({})).toBeNull();
    expect(parseDiscogsSearch({ results: [{ label: [""] }] })).toBeNull();
  });
});
