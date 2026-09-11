// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateProviderReleaseDate } from "../src/lore/release-evidence.js";

describe("validateProviderReleaseDate", () => {
  it.each([
    ["1977", "year", 1977],
    ["2025-11", "month", 2025],
    ["2025-11-07", "day", 2025],
  ] as const)("accepts honest partial dates", (value, precision, year) => {
    expect(validateProviderReleaseDate(value, precision)).toEqual({
      releaseDate: value,
      precision,
      year,
    });
  });

  it.each([
    ["not a date", null],
    ["2025-02-30", "day"],
    ["2025-13", "month"],
    ["2025", "day"],
    ["0999", "year"],
  ] as const)("rejects invalid or falsely precise dates", (value, precision) => {
    expect(validateProviderReleaseDate(value, precision)).toBeNull();
  });
});