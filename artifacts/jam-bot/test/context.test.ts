import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AcrMatch } from "../src/turntable/acrcloud.js";

// The enrichment logic now lives in @workspace/song-enrichment; context.ts
// imports its Last.fm/Wikipedia/Genius collaborators by the lib's own relative
// paths, so the mocks (and the handles we read back) must target those lib
// modules.
vi.mock("../../../lib/song-enrichment/src/lastfm.js", () => ({
  lastfmEnabled: vi.fn(() => true),
  fetchArtistTags: vi.fn(),
  fetchSimilarArtists: vi.fn(),
}));
vi.mock("../../../lib/song-enrichment/src/wikipedia.js", () => ({
  wikipediaEnabled: vi.fn(() => true),
  fetchArtistBio: vi.fn(),
}));
vi.mock("../../../lib/song-enrichment/src/genius.js", () => ({
  geniusEnabled: vi.fn(() => true),
  fetchGeniusUrl: vi.fn(),
}));
vi.mock("../src/llm/openrouter.js", () => ({
  askLLM: vi.fn(),
}));

const context = await import("../../../lib/song-enrichment/src/context.js");
const lf = await import("../../../lib/song-enrichment/src/lastfm.js");
const wiki = await import("../../../lib/song-enrichment/src/wikipedia.js");
const gen = await import("../../../lib/song-enrichment/src/genius.js");
const llm = await import("../src/llm/openrouter.js");

function mkMatch(over: Partial<AcrMatch> = {}): AcrMatch {
  return {
    acrid: "acr-1",
    title: "Midnight City",
    artist: "M83",
    album: "Hurry Up, We're Dreaming",
    playOffsetMs: 0,
    ...over,
  };
}

const spTrack = {
  id: "sp1",
  uri: "spotify:track:sp1",
  title: "Midnight City",
  artist: "M83",
  album: "Hurry Up, We're Dreaming",
  durationMs: 240000,
};

function uniqueIsrc() {
  return `TEST${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

// The track_context cache is keyed by artist name and persists for the whole
// test file (shared DB), so every test that asserts on freshly-fetched values
// must use its own artist to avoid colliding with another test's cache entry.
function uniqueArtist() {
  return `Artist-${Math.random().toString(36).slice(2, 10)}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  (lf.lastfmEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (wiki.wikipediaEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (gen.geniusEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (lf.fetchSimilarArtists as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (wiki.fetchArtistBio as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (gen.fetchGeniusUrl as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("enrichContext", () => {
  it("combines Last.fm tags/similar, a Wikipedia bio, and a Genius link", async () => {
    (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mockResolvedValue([
      "electronic",
      "shoegaze",
    ]);
    (lf.fetchSimilarArtists as ReturnType<typeof vi.fn>).mockResolvedValue([
      "Tycho",
    ]);
    (wiki.fetchArtistBio as ReturnType<typeof vi.fn>).mockResolvedValue({
      extract: "M83 is a French electronic music project.",
      title: "M83 (band)",
      url: "https://en.wikipedia.org/wiki/M83_(band)",
    });
    (gen.fetchGeniusUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
      "https://genius.com/M83-midnight-city-lyrics",
    );

    const artist = uniqueArtist();
    const result = await context.enrichContext({
      match: mkMatch({ artist, isrc: uniqueIsrc() }),
      track: { ...spTrack, artist },
      viaIsrc: true,
    });
    expect(result).not.toBeNull();
    expect(result?.tags).toEqual(["electronic", "shoegaze"]);
    expect(result?.similarArtists).toEqual(["Tycho"]);
    expect(result?.bio).toBe("M83 is a French electronic music project.");
    expect(result?.geniusUrl).toBe(
      "https://genius.com/M83-midnight-city-lyrics",
    );
    expect(result?.approximate).toBe(false);
  });

  it("flags approximate when the track was not matched by ISRC", async () => {
    (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mockResolvedValue(["rock"]);
    const artist = uniqueArtist();
    const result = await context.enrichContext({
      match: mkMatch({ artist, isrc: undefined }),
      track: { ...spTrack, artist },
      viaIsrc: false,
    });
    expect(result?.approximate).toBe(true);
  });

  it("returns null when nothing useful resolves", async () => {
    const artist = uniqueArtist();
    const result = await context.enrichContext({
      match: mkMatch({ artist, isrc: uniqueIsrc() }),
      track: { ...spTrack, artist },
      viaIsrc: true,
    });
    expect(result).toBeNull();
  });

  it("returns null when the feature is disabled (no sources)", async () => {
    (lf.lastfmEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (wiki.wikipediaEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (gen.geniusEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mockResolvedValue(["rock"]);
    const result = await context.enrichContext({
      match: mkMatch(),
      track: spTrack,
      viaIsrc: true,
    });
    expect(result).toBeNull();
    expect(lf.fetchArtistTags).not.toHaveBeenCalled();
  });

  it("caches artist-level data: a replay does not re-hit the sources", async () => {
    const isrc = uniqueIsrc();
    const artist = uniqueArtist();
    (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mockResolvedValue([
      "electronic",
    ]);
    const first = await context.enrichContext({
      match: mkMatch({ artist, isrc }),
      track: { ...spTrack, artist },
      viaIsrc: true,
    });
    expect(first?.tags).toEqual(["electronic"]);
    const calls = (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mock.calls
      .length;

    const second = await context.enrichContext({
      match: mkMatch({ artist, isrc }),
      track: { ...spTrack, artist },
      viaIsrc: true,
    });
    expect(second?.tags).toEqual(["electronic"]);
    expect(
      (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(calls);
  });

  it("shares artist-level cache across different songs by the same artist", async () => {
    (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mockResolvedValue([
      "electronic",
    ]);
    const artist = `Artist-${Math.random().toString(36).slice(2, 8)}`;
    await context.enrichContext({
      match: mkMatch({ artist, title: "Song One", isrc: uniqueIsrc() }),
      track: { ...spTrack, artist, title: "Song One" },
      viaIsrc: true,
    });
    const calls = (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await context.enrichContext({
      match: mkMatch({ artist, title: "Song Two", isrc: uniqueIsrc() }),
      track: { ...spTrack, artist, title: "Song Two" },
      viaIsrc: true,
    });
    // Artist fetch reused from cache; only the song-level Genius lookup re-runs.
    expect(
      (lf.fetchArtistTags as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(calls);
  });
});

describe("contextBlocks", () => {
  it("renders genre, similar artists, bio with link, and lyrics", () => {
    const blocks = context.contextBlocks({
      tags: ["electronic", "shoegaze"],
      similarArtists: ["Tycho", "Bonobo"],
      bio: "M83 is a French electronic music project.",
      wikipediaUrl: "https://en.wikipedia.org/wiki/M83_(band)",
      geniusUrl: "https://genius.com/M83-midnight-city-lyrics",
      approximate: false,
      fetchedAtMs: 0,
    });
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: { text: string } }).text.text;
    expect(text).toContain("*Genre:* electronic · shoegaze");
    expect(text).toContain("*Similar artists:* Tycho, Bonobo");
    expect(text).toContain("M83 is a French electronic music project.");
    expect(text).toContain("Wikipedia");
    expect(text).toContain("<https://genius.com/M83-midnight-city-lyrics|Genius>");
  });

  it("labels the lyrics link as approximate when not ISRC-matched", () => {
    const blocks = context.contextBlocks({
      tags: ["rock"],
      similarArtists: [],
      geniusUrl: "https://genius.com/song",
      approximate: true,
      fetchedAtMs: 0,
    });
    const text = (blocks[0] as { text: { text: string } }).text.text;
    expect(text).toContain("_(matched by title)_");
  });

  it("returns [] when there is nothing beyond the header", () => {
    expect(
      context.contextBlocks({
        tags: [],
        similarArtists: [],
        approximate: false,
        fetchedAtMs: 0,
      }),
    ).toEqual([]);
  });
});

describe("contextSummaryIsGrounded", () => {
  const ctx = {
    artistName: "M83",
    tags: ["electronic", "shoegaze"],
    similarArtists: ["Tycho"],
    bio: "M83 is a French electronic music project from Antibes.",
    approximate: false,
    fetchedAtMs: 0,
  };

  it("accepts a sentence built from facts plus allowed connective words", () => {
    expect(
      context.contextSummaryIsGrounded(
        "Dreamy electronic shoegaze from M83, in the style of Tycho.",
        spTrack,
        ctx,
      ),
    ).toBe(true);
  });

  it("rejects a sentence inventing an unlisted capitalized name", () => {
    expect(
      context.contextSummaryIsGrounded(
        "Electronic from M83, alongside Daft Punk.",
        spTrack,
        ctx,
      ),
    ).toBe(false);
  });

  it("rejects an invented LOWERCASE genre not in the facts", () => {
    expect(
      context.contextSummaryIsGrounded(
        "M83 helped define the vaporwave sound.",
        spTrack,
        ctx,
      ),
    ).toBe(false);
  });

  it("rejects an invented place not in the facts", () => {
    expect(
      context.contextSummaryIsGrounded(
        "Electronic music from M83, born in berlin.",
        spTrack,
        ctx,
      ),
    ).toBe(false);
  });

  it("rejects an invented year not in the facts", () => {
    expect(
      context.contextSummaryIsGrounded(
        "Electronic shoegaze from M83, released in 1979.",
        spTrack,
        ctx,
      ),
    ).toBe(false);
  });

  it("rejects an invented decade not in the facts", () => {
    expect(
      context.contextSummaryIsGrounded(
        "Electronic from M83, a sound of the 80s.",
        spTrack,
        ctx,
      ),
    ).toBe(false);
  });

  it("accepts a year when it is present in the facts (bio)", () => {
    const dated = {
      ...ctx,
      bio: "M83 is a French electronic project formed in 2001.",
    };
    expect(
      context.contextSummaryIsGrounded(
        "Electronic music from M83, formed in 2001.",
        spTrack,
        dated,
      ),
    ).toBe(true);
  });
});

describe("buildContextSummary", () => {
  const ctx = {
    artistName: "M83",
    tags: ["electronic"],
    similarArtists: ["Tycho"],
    approximate: false,
    fetchedAtMs: 0,
  };

  it("returns null when the summary toggle is off", async () => {
    // TRACK_CONTEXT_LLM_SUMMARY defaults to false in tests.
    const out = await context.buildContextSummary(spTrack, ctx);
    expect(out).toBeNull();
    expect(llm.askLLM).not.toHaveBeenCalled();
  });
});
