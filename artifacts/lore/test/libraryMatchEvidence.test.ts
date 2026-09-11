import { describe, expect, it } from "vitest";
import { libraryMatchEvidence } from "../src/lib/libraryMatchEvidence";

describe("libraryMatchEvidence", () => {
  it("shows only canonical recording facts that match active filters", () => {
    expect(libraryMatchEvidence(
      { genres: ["Jazz", "made-up-style"], releaseYear: 2024 },
      { genres: ["jazz", "rock"], ages: ["catalog"] },
    )).toEqual(["Jazz", "Catalog"]);
  });

  it("uses the selected deep-catalog decade instead of a generic era", () => {
    expect(libraryMatchEvidence(
      { genres: ["rock"], releaseYear: 1987 },
      { genres: [], ages: ["deep"], decade: 1980 },
    )).toEqual(["1980s"]);
  });

  it("never presents unknown or non-matching metadata as evidence", () => {
    expect(libraryMatchEvidence(
      { genres: ["unknown"], releaseYear: null },
      { genres: ["jazz"], ages: ["deep"] },
    )).toEqual([]);
    expect(libraryMatchEvidence(
      { genres: ["rock"], releaseYear: 1987 },
      { genres: ["jazz"], ages: ["current"], decade: 1990 },
    )).toEqual([]);
  });
});