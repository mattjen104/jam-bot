import { describe, expect, it } from "vitest";
import {
  libraryMatchEvidence,
  removeLibraryMatchFilter,
} from "../src/lib/libraryMatchEvidence";

describe("libraryMatchEvidence", () => {
  it("shows only canonical recording facts that match active filters", () => {
    expect(libraryMatchEvidence(
      { genres: ["Jazz", "made-up-style"], releaseYear: 2024 },
      { genres: ["jazz", "rock"], ages: ["catalog"] },
    )).toEqual([
      { kind: "genre", value: "jazz", label: "Jazz" },
      { kind: "era", value: "catalog", label: "Catalog" },
    ]);
  });

  it("uses the selected deep-catalog decade instead of a generic era", () => {
    expect(libraryMatchEvidence(
      { genres: ["rock"], releaseYear: 1987 },
      { genres: [], ages: ["deep"], decade: 1980 },
    )).toEqual([{ kind: "era", value: "deep", label: "1980s" }]);
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

  it("removes only the selected genre from URL-backed filters", () => {
    const params = new URLSearchParams("genre=rock%2Cindie&age=current");
    removeLibraryMatchFilter(params, { kind: "genre", value: "rock", label: "Rock" });
    expect(params.get("genre")).toBe("indie");
    expect(params.get("age")).toBe("current");
  });

  it("removes a decade and its deep-catalog era together", () => {
    const params = new URLSearchParams("age=current%2Cdeep&decade=1990");
    removeLibraryMatchFilter(params, { kind: "era", value: "deep", label: "1990s" });
    expect(params.get("age")).toBe("current");
    expect(params.has("decade")).toBe(false);
  });
});