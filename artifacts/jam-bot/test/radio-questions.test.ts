import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerLiveRadio, answerRadioRecommendation, parseRadioQuestion } from "../src/llm/radio-questions.js";

describe("radio question source policy", () => {
  it("uses any speaker's stated taste rather than Matt's shared library", () => {
    expect(parseRadioQuestion("what would be a good radio station for me if I like jazz?"))
      .toEqual({ kind: "recommend", taste: "jazz" });
    expect(parseRadioQuestion("Recommend a radio station for someone who likes Kelela"))
      .toEqual({ kind: "recommend", taste: "Kelela" });
    expect(parseRadioQuestion("what stations play shoegaze?"))
      .toEqual({ kind: "recommend", taste: "shoegaze" });
    expect(parseRadioQuestion("recommend a station for me"))
      .toEqual({ kind: "taste-needed" });
  });

  it("only uses the shared source on an explicit library reference", () => {
    expect(parseRadioQuestion("What stations cross with Matt's library?"))
      .toEqual({ kind: "shared" });
    expect(parseRadioQuestion("What's on air that matches our shared Lore library?"))
      .toEqual({ kind: "shared" });
    expect(parseRadioQuestion("What stations match my library?"))
      .toEqual({ kind: "my-library" });
    expect(parseRadioQuestion("What radio stations are on air?"))
      .toEqual({ kind: "live" });
    expect(parseRadioQuestion("What did we play in Jam history?")).toBeNull();
    expect(parseRadioQuestion("What's playing?")).toBeNull();
    expect(parseRadioQuestion("play the radio")).toBeNull();
    expect(parseRadioQuestion("read https://example.com/about-stations")).toBeNull();
  });
});

describe("public live feed", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("only reports confirmed recent observations, never listener flags or stale rows", async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/stations/now-playing")
        ? { items: [
          { slug: "fresh", nowPlaying: { freshness: "fresh", observedAt: now,
            rawArtist: "A", rawTitle: "B", isLibraryHit: true } },
          { slug: "old", nowPlaying: { freshness: "fresh", observedAt: old,
            rawArtist: "C", rawTitle: "D" } },
          { slug: "missing", nowPlaying: null },
        ] }
        : { stations: [{ slug: "fresh", name: "Fresh Station" },
          { slug: "old", name: "Old Station" }, { slug: "missing", name: "No Data" }] },
    )));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await answerLiveRadio();
    expect(answer).toContain("Fresh Station: A — B");
    expect(answer).toContain("observed");
    expect(answer).not.toContain("Old Station");
    expect(answer).not.toContain("isLibraryHit");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });

  it("does not turn a cold stations-only partial into a definitive no-play claim", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/stations/now-playing")
        ? { items: [{ slug: "a", nowPlaying: null }] }
        : { stations: [{ slug: "a", name: "A" }] },
    ))));
    expect(await answerLiveRadio()).toContain("don't have a fresh confirmed track observation");
  });
});

describe("public station recommendations", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("uses evidence from Lore's sampled spins, never a library or Spotify session", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("kind=artist")
        ? { sample: { capReached: false }, recommendations: [{
          station: { slug: "kexp", name: "KEXP" },
          evidence: { spinCount30d: 4, spinCount90d: 8, latestSpinAt: "2026-09-01T12:00:00Z" },
        }] }
        : { sample: { capReached: false }, recommendations: [] },
    )));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await answerRadioRecommendation("Kelela");
    expect(answer).toContain("your stated taste");
    expect(answer).toContain("KEXP — 4 sampled artist spins");
    expect(answer).toContain("not Matt's library");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("q=Kelela");
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });

  it("does not recommend stations on one spin or confuse artist and genre", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({
      sample: { capReached: true, sampledThrough: "2026-09-02T00:00:00Z" },
      recommendations: [{
        station: { slug: "one", name: "One Spin" },
        evidence: { spinCount30d: 1, spinCount90d: 1, latestSpinAt: "2026-09-03T00:00:00Z" },
      }],
      kind: url.includes("kind=artist") ? "artist" : "genre",
    }))));
    expect(await answerRadioRecommendation("jazz")).toContain("Which did you mean?");
  });
});