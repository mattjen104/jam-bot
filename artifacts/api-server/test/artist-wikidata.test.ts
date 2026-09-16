import { describe, expect, it } from "vitest";
import {
  artistMetadataTtlMs,
  mapWikidataArtistEntity,
} from "../src/lore/artist-wikidata.js";
import { parseArtistWikidataQid } from "@workspace/song-enrichment";

describe("MusicBrainz → Wikidata artist bridge", () => {
  it("uses bounded TTLs for success, misses, and provider errors", () => {
    expect(artistMetadataTtlMs("success")).toBe(30 * 24 * 60 * 60 * 1000);
    expect(artistMetadataTtlMs("not_found")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(artistMetadataTtlMs("error")).toBe(60 * 60 * 1000);
  });

  it("accepts only a direct MusicBrainz Wikidata URL relation", () => {
    expect(parseArtistWikidataQid({
      relations: [
        { type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/Q42" } },
        { type: "wikidata", url: { resource: "https://www.wikidata.org/entity/Q7" } },
        { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42" } },
      ],
    })).toBe("Q42");
  });

  it("maps only the bounded explicit artist allow-list", () => {
    const mapped = mapWikidataArtistEntity({
      entities: {
        Q42: {
          aliases: { en: [{ value: "The Example" }, { value: "Example" }] },
          claims: {
            P571: [{ mainsnak: { snaktype: "value", datavalue: { value: { time: "+1980-00-00T00:00:00Z" } } } }],
            P740: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q99" } } } }],
            P856: [{ mainsnak: { snaktype: "value", datavalue: { value: "https://example.com" } } }],
            P264: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q10" } } } }],
            P463: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q11" } } } }],
            P527: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q12" } } } }],
            P31: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q13" } } } }],
          },
        },
      },
    });
    expect(mapped).toEqual({
      aliases: ["The Example", "Example"],
      inceptionDate: "1980-00-00",
      formationPlace: { qid: "Q99", url: "https://www.wikidata.org/wiki/Q99" },
      officialWebsite: "https://example.com",
      recordLabels: [{ qid: "Q10", url: "https://www.wikidata.org/wiki/Q10" }],
      groups: [{ qid: "Q11", url: "https://www.wikidata.org/wiki/Q11" }],
      members: [{ qid: "Q12", url: "https://www.wikidata.org/wiki/Q12" }],
    });
  });
});