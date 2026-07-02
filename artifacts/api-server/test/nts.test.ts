import { describe, expect, it } from "vitest";
import {
  parseNtsEpisodes,
  parseNtsTracklist,
  ntsExternalId,
  ntsEpisodeUrl,
} from "../src/lore/nts.js";

describe("parseNtsEpisodes", () => {
  it("handles malformed bodies without throwing", () => {
    expect(parseNtsEpisodes(null)).toEqual([]);
    expect(parseNtsEpisodes({})).toEqual([]);
    expect(parseNtsEpisodes({ results: "nope" as unknown })).toEqual([]);
  });

  it("parses published episodes and keeps API order (newest-first)", () => {
    const eps = parseNtsEpisodes({
      results: [
        {
          episode_alias: "show-2nd-june-2024",
          name: "Episode Two",
          status: "published",
          broadcast: "2024-06-02T09:00:00Z",
        },
        {
          episode_alias: "show-26th-may-2024",
          name: "Episode One",
          status: "published",
          broadcast: "2024-05-26T09:00:00Z",
        },
      ],
    });
    expect(eps).toHaveLength(2);
    expect(eps[0]?.episodeAlias).toBe("show-2nd-june-2024");
    expect(eps[0]?.broadcast?.toISOString()).toBe("2024-06-02T09:00:00.000Z");
    expect(eps[1]?.name).toBe("Episode One");
  });

  it("skips unpublished episodes and ones missing alias or name", () => {
    const eps = parseNtsEpisodes({
      results: [
        { episode_alias: "draft-ep", name: "Draft", status: "draft" },
        { episode_alias: "", name: "No alias" },
        { episode_alias: "no-name-ep" },
        { episode_alias: "good-ep", name: "Good" },
      ],
    });
    expect(eps).toHaveLength(1);
    expect(eps[0]?.episodeAlias).toBe("good-ep");
    expect(eps[0]?.broadcast).toBeNull();
  });

  it("nulls an unparseable broadcast date instead of fabricating one", () => {
    const eps = parseNtsEpisodes({
      results: [
        { episode_alias: "ep", name: "Ep", broadcast: "not-a-date" },
      ],
    });
    expect(eps[0]?.broadcast).toBeNull();
  });
});

describe("parseNtsTracklist", () => {
  it("handles malformed bodies without throwing", () => {
    expect(parseNtsTracklist(null)).toEqual([]);
    expect(parseNtsTracklist({})).toEqual([]);
    expect(parseNtsTracklist({ embeds: {} })).toEqual([]);
  });

  it("parses ordered artist/title entries and skips incomplete rows", () => {
    const tracks = parseNtsTracklist({
      embeds: {
        tracklist: {
          results: [
            { artist: "Alice Coltrane", title: "Journey in Satchidananda", uid: "u1" },
            { artist: "", title: "No artist" },
            { artist: "No title" },
            { artist: "  Pharoah Sanders  ", title: "  Astral Traveling  " },
          ],
        },
      },
    });
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toEqual({
      artist: "Alice Coltrane",
      title: "Journey in Satchidananda",
      uid: "u1",
    });
    // Whitespace is trimmed; uid omitted when absent.
    expect(tracks[1]).toEqual({
      artist: "Pharoah Sanders",
      title: "Astral Traveling",
    });
  });
});

describe("nts identifiers", () => {
  it("builds stable externalIds keyed by episode and ordinal", () => {
    expect(ntsExternalId("questing-2nd-june-2024", 0)).toBe(
      "nts:questing-2nd-june-2024:0",
    );
    expect(ntsExternalId("questing-2nd-june-2024", 12)).toBe(
      "nts:questing-2nd-june-2024:12",
    );
  });

  it("builds the public episode page URL used as the run citation", () => {
    expect(ntsEpisodeUrl("questing-w-zakia", "questing-2nd-june-2024")).toBe(
      "https://www.nts.live/shows/questing-w-zakia/episodes/questing-2nd-june-2024",
    );
  });
});
