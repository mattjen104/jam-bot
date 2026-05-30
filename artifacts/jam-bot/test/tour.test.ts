import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/spotify/client.js", () => ({
  searchTrack: vi.fn(),
}));

vi.mock("../src/llm/openrouter.js", () => ({
  curateTourPicks: vi.fn(),
  writeTourTidbits: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function hit(id: string, title: string, artist: string, album = "Album") {
  return { id, uri: `spotify:track:${id}`, title, artist, album, durationMs: 1000 };
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
      { title: "Real One", artist: "A", album: "Album1" },
      { title: "Real Two", artist: "B", album: "Album2" },
    ]);
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
