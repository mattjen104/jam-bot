import { describe, it, expect } from "vitest";
import { parseWikiSummary } from "../src/turntable/wikipedia.js";

describe("Wikipedia summary parsing", () => {
  it("extracts the bio snippet, title, and a canonical URL", () => {
    const bio = parseWikiSummary({
      query: {
        pages: {
          "12345": {
            title: "Miles Davis",
            extract:
              "Miles Dewey Davis III was an American jazz trumpeter, " +
              "bandleader, and composer.",
          },
        },
      },
    });
    expect(bio).toEqual({
      title: "Miles Davis",
      extract:
        "Miles Dewey Davis III was an American jazz trumpeter, " +
        "bandleader, and composer.",
      url: "https://en.wikipedia.org/wiki/Miles_Davis",
    });
  });

  it("URL-encodes special characters in the title", () => {
    const bio = parseWikiSummary({
      query: {
        pages: {
          "1": { title: "Sigur Rós", extract: "An Icelandic band." },
        },
      },
    });
    expect(bio?.url).toBe("https://en.wikipedia.org/wiki/Sigur_R%C3%B3s");
  });

  it("returns null when the page is missing or has no extract", () => {
    expect(parseWikiSummary({})).toBeNull();
    expect(parseWikiSummary({ query: { pages: {} } })).toBeNull();
    expect(
      parseWikiSummary({
        query: { pages: { "-1": { title: "Nope", missing: "" } } },
      }),
    ).toBeNull();
    expect(
      parseWikiSummary({ query: { pages: { "1": { title: "X", extract: "  " } } } }),
    ).toBeNull();
  });
});
