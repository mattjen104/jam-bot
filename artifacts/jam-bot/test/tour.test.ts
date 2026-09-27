import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/spotify/client.js", () => ({
  searchTrack: vi.fn(),
}));

vi.mock("../src/llm/openrouter.js", () => ({
  curateTourPicks: vi.fn(),
  writeTourTidbits: vi.fn(),
}));

vi.mock("../src/tour-release-evidence.js", () => ({
  recordingFirstReleaseYear: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function hit(id: string, title: string, artist: string, album = "Album", releaseDate?: string, albumType?: string) {
  return { id, uri: `spotify:track:${id}`, title, artist, album, durationMs: 1000, releaseDate, albumType, isrc: `USAAA1234567` };
}

describe("parseTourLength", () => {
  it("defaults to the configured tour length when none is specified", async () => {
    const { parseTourLength } = await import("../src/tour.js");
    expect(parseTourLength("a tour of motown")).toBe(6);
  });

  it("parses an explicit count and clamps to the max", async () => {
    const { parseTourLength } = await import("../src/tour.js");
    expect(parseTourLength("give us a 5-track tour of dub")).toBe(5);
    expect(parseTourLength("a 4 song tour of soul")).toBe(4);
    expect(parseTourLength("a 99-track tour of jazz")).toBe(12); // clamped to max
  });
});

describe("isStopTourRequest", () => {
  it("matches stop/end phrasings and ignores unrelated chatter", async () => {
    const { isStopTourRequest } = await import("../src/tour.js");
    expect(isStopTourRequest("stop the tour")).toBe(true);
    expect(isStopTourRequest("end the tour please")).toBe(true);
    expect(isStopTourRequest("ok the tour is over")).toBe(true);
    expect(isStopTourRequest("that tour was great, what's next?")).toBe(false);
    expect(isStopTourRequest("play some jazz")).toBe(false);
  });
});

describe("isSaveTourRequest", () => {
  it("matches save phrasings and ignores unrelated chatter", async () => {
    const { isSaveTourRequest } = await import("../src/tour.js");
    expect(isSaveTourRequest("save the tour")).toBe(true);
    expect(isSaveTourRequest("save this tour")).toBe(true);
    expect(isSaveTourRequest("can you save this as a playlist?")).toBe(true);
    expect(isSaveTourRequest("save it to a playlist")).toBe(true);
    // No tour/playlist anchor -> not a save-tour request.
    expect(isSaveTourRequest("save me a seat")).toBe(false);
    expect(isSaveTourRequest("that tour was great")).toBe(false);
    expect(isSaveTourRequest("play some jazz")).toBe(false);
  });
});

describe("buildTour", () => {
  it("queues only real, findable tracks and drops fabricated/unfindable picks", async () => {
    const spotify = await import("../src/spotify/client.js");
    const llm = await import("../src/llm/openrouter.js");
    const { buildTour } = await import("../src/tour.js");

    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "A quick tour.",
      picks: [
        { title: "Real One", artist: "A" },
        { title: "Fabricated Song", artist: "Nobody" },
        { title: "Real Two", artist: "B" },
      ],
    });
    // Second pick can't be resolved -> dropped, never queued.
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => {
        if (q.startsWith("Real One")) return hit("1", "Real One", "A", "Album1");
        if (q.startsWith("Real Two")) return hit("2", "Real Two", "B", "Album2");
        return null;
      },
    );
    (llm.writeTourTidbits as ReturnType<typeof vi.fn>).mockResolvedValue([
      "Tidbit one.",
      "Tidbit two.",
    ]);

    const tour = await buildTour("test theme", 6);
    expect(tour.tracks.map((t) => t.trackId)).toEqual(["1", "2"]);
    expect(tour.tracks.map((t) => t.tidbit)).toEqual([
      "Tidbit one.",
      "Tidbit two.",
    ]);
    // Tidbits are written for the RESOLVED tracks (real album from Spotify).
    expect(llm.writeTourTidbits).toHaveBeenCalledWith("test theme", [
      { title: "Real One", artist: "A", album: "Album1", releaseYear: undefined },
      { title: "Real Two", artist: "B", album: "Album2", releaseYear: undefined },
    ]);
  });

  it("omits older recordings reissued in the era and picks with uncertain recording dates", async () => {
    const spotify = await import("../src/spotify/client.js");
    const llm = await import("../src/llm/openrouter.js");
    const evidence = await import("../src/tour-release-evidence.js");
    const { buildTour } = await import("../src/tour.js");
    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "This went to number one in 1968.",
      picks: ["Later", "Reissue", "Unknown", "Right"].map((title) => ({ title, artist: "A" })),
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockImplementation(async (q: string) => {
      if (q.startsWith("Later")) return hit("1", "Later", "A", "Later Album", "1971-01-01", "album");
      if (q.startsWith("Reissue")) return hit("2", "Reissue", "A", "Reissue Album", "1968", "album");
      if (q.startsWith("Unknown")) return hit("3", "Unknown", "A", "Mystery");
      return hit("4", "Right", "A", "Original Album", "1967-03-01", "album");
    });
    (evidence.recordingFirstReleaseYear as ReturnType<typeof vi.fn>).mockImplementation(
      async (_isrc: string, title: string) => ({ Later: 1971, Reissue: 1959, Right: 1967 })[title as "Later" | "Reissue" | "Right"] ?? null,
    );
    (llm.writeTourTidbits as ReturnType<typeof vi.fn>).mockResolvedValue(["Verified."]);
    const tour = await buildTour("1960s soul", 4);
    expect(tour.tracks.map((track) => track.trackId)).toEqual(["4"]);
    expect(llm.writeTourTidbits).toHaveBeenCalledWith("1960s soul", [
      { title: "Right", artist: "A", album: "Original Album", releaseYear: 1967 },
    ]);
    expect(tour.intro).not.toContain("number one");
  });

  it("requires recording evidence even for a Spotify edition dated inside the requested era", async () => {
    const spotify = await import("../src/spotify/client.js");
    const llm = await import("../src/llm/openrouter.js");
    const evidence = await import("../src/tour-release-evidence.js");
    const { buildTour } = await import("../src/tour.js");
    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "", picks: [{ title: "Old song", artist: "A" }],
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockResolvedValue(
      hit("old", "Old song", "A", "New edition", "1968", "album"),
    );
    (evidence.recordingFirstReleaseYear as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await buildTour("1960s", 1)).tracks).toEqual([]);
    expect(llm.writeTourTidbits).not.toHaveBeenCalled();
  });

  it("recognizes short decades and explicit years without treating undated themes as eras", async () => {
    const { requestedTourYears } = await import("../src/tour.js");
    expect(requestedTourYears("90s shoegaze")).toEqual({ start: 1990, end: 1999 });
    expect(requestedTourYears("music of 1971")).toEqual({ start: 1971, end: 1971 });
    expect(requestedTourYears("1960s soul")).toEqual({ start: 1960, end: 1969 });
    expect(requestedTourYears("late 60s soul")).toEqual({ start: 1967, end: 1969 });
    expect(requestedTourYears("1965 through 1969")).toEqual({ start: 1965, end: 1969 });
    expect(requestedTourYears("Motown")).toBeNull();
  });

  it("narrates only resolved metadata, not invented chart or personnel details", async () => {
    const { writeTourTidbits } = await vi.importActual<typeof import("../src/llm/openrouter.js")>(
      "../src/llm/openrouter.js",
    );
    expect(await writeTourTidbits("1960s chart toppers", [
      { title: "A Song", artist: "A Band", album: "The Album", releaseYear: 1967 },
      { title: "Another", artist: "B", album: "Other" },
    ])).toEqual([
      '"A Song" — A Band, from The Album (Spotify edition dated 1967).',
      '"Another" — B, from Other.',
    ]);
  });

  it("uses the recording's first-release-date from the ISRC response, not an edition date", async () => {
    const { recordingFirstReleaseYear } = await vi.importActual<typeof import("../src/tour-release-evidence.js")>(
      "../src/tour-release-evidence.js",
    );
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recordings: [{
        title: "Old Song",
        "artist-credit": [{ artist: { name: "The Band" } }],
        "first-release-date": "1959-02-03",
      }] }),
    });
    globalThis.fetch = fetchMock;
    try {
      expect(await recordingFirstReleaseYear("USABC1234567", "Old Song", "The Band")).toBe(1959);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/isrc/USABC1234567?"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      // The same ISRC does not prove a different artist/title is the same recording.
      expect(await recordingFirstReleaseYear("USABC1234567", "Different Song", "Other Band")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dedups picks that resolve to the same track id", async () => {
    const spotify = await import("../src/spotify/client.js");
    const llm = await import("../src/llm/openrouter.js");
    const { buildTour } = await import("../src/tour.js");

    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "",
      picks: [
        { title: "Same", artist: "A" },
        { title: "Same Again", artist: "A" },
      ],
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockResolvedValue(
      hit("dup", "Same", "A"),
    );
    (llm.writeTourTidbits as ReturnType<typeof vi.fn>).mockResolvedValue(["t"]);

    const tour = await buildTour("x", 6);
    expect(tour.tracks).toHaveLength(1);
  });

  it("falls back to a minimal factual tidbit when narration fails", async () => {
    const spotify = await import("../src/spotify/client.js");
    const llm = await import("../src/llm/openrouter.js");
    const { buildTour } = await import("../src/tour.js");

    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "",
      picks: [{ title: "Solo", artist: "X" }],
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockResolvedValue(
      hit("s", "Solo", "X", "Only Album"),
    );
    (llm.writeTourTidbits as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );

    const tour = await buildTour("x", 6);
    expect(tour.tracks).toHaveLength(1);
    expect(tour.tracks[0]!.tidbit).toBe('"Solo" — X, from Only Album.');
  });

  it("returns an empty tour when nothing resolves", async () => {
    const spotify = await import("../src/spotify/client.js");
    const llm = await import("../src/llm/openrouter.js");
    const { buildTour } = await import("../src/tour.js");

    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "",
      picks: [{ title: "Ghost", artist: "Nobody" }],
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const tour = await buildTour("x", 6);
    expect(tour.tracks).toHaveLength(0);
    expect(llm.writeTourTidbits).not.toHaveBeenCalled();
  });
});
