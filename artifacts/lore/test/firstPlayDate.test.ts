import { describe, expect, it } from "vitest";
import { releaseDateLabel } from "../src/lib/firstPlayDate";

describe("first-play date grammar", () => {
  it.each([
    [{ releaseDate: "2026-09-18", releaseYear: 2026 }, "18 Sep 2026"],
    [{ releaseDate: "2026-09", releaseYear: 2026 }, "Sep 2026"],
    [{ releaseDate: "2026", releaseYear: 2026 }, "2026"],
    [{ releaseDate: null, releaseYear: 2026 }, "2026"],
    [{ releaseDate: null, releaseYear: null }, "Date unknown"],
  ])("renders only the precision the source provides", (item, expected) => {
    expect(releaseDateLabel(item)).toBe(expected);
  });
});