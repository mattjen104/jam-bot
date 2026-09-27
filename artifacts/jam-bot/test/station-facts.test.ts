import { beforeEach, describe, expect, it, vi } from "vitest";

const directory = {
  stations: [
    {
      slug: "kexp",
      name: "KEXP",
      org: "University of Washington",
      city: "Seattle",
      region: "Washington",
      country: "United States",
      locationConfidence: "high",
      locationSource: "station-provided",
      homepageUrl: "https://www.kexp.org/",
    },
    {
      slug: "kexp-2",
      name: "KEXP",
      org: null,
      city: "Elsewhere",
      region: null,
      country: "Canada",
      locationConfidence: "medium",
      locationSource: "catalog",
      homepageUrl: null,
    },
  ],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

async function moduleUnderTest() {
  vi.resetModules();
  return import("../src/llm/station-facts.js");
}

describe("station facts answers", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches exact normalized station slug/name and reports ambiguous matches", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      stations: [directory.stations[0]],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { answerStationQuestion } = await moduleUnderTest();
    const answer = await answerStationQuestion("Where is KEXP based?");
    expect(answer).toContain("KEXP is listed as based in Seattle, Washington, United States");

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(directory)));
    const ambiguousModule = await import("../src/llm/station-facts.js");
    expect(await ambiguousModule.answerStationQuestion("Where is KEXP based?"))
      .toContain("more than one matching station");
    expect(await ambiguousModule.answerStationQuestion("Where is KEXP-2 based?"))
      .toContain("KEXP is listed as based in Elsewhere, Canada");
  });

  it("uses careful location phrasing and no coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      stations: [{ ...directory.stations[0], latitude: 47.6, longitude: -122.3 }],
    })));
    const { answerStationQuestion } = await moduleUnderTest();
    const answer = await answerStationQuestion("Where is KEXP based?");
    expect(answer).toContain("listed as based in");
    expect(answer).toContain("location confidence: high");
    expect(answer).not.toContain("47.6");
    expect(answer).not.toContain("broadcast");
  });

  it("requires fresh observedAt freshness for now-playing claims, not recent playedAt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ stations: [directory.stations[0]] }))
      .mockResolvedValueOnce(jsonResponse({
        nowPlaying: {
          playedAt: "2020-01-01T00:00:00.000Z",
          observedAt: new Date().toISOString(),
          freshness: "fresh",
          rawArtist: "Artist",
          rawTitle: "Song",
          listenerNames: ["private"],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { answerStationQuestion } = await moduleUnderTest();
    expect(await answerStationQuestion("What is playing on KEXP?")).toContain("Artist — Song");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/stations/kexp/now-playing");

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ stations: [directory.stations[0]] }))
      .mockResolvedValueOnce(jsonResponse({
        nowPlaying: {
          playedAt: new Date().toISOString(),
          observedAt: "2020-01-01T00:00:00.000Z",
          freshness: "stale",
          rawArtist: "Old Artist",
          rawTitle: "Old Song",
        },
      })));
    const staleModule = await import("../src/llm/station-facts.js");
    expect(await staleModule.answerStationQuestion("What is playing on KEXP?"))
      .toContain("stale or unconfirmed");

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ stations: [directory.stations[0]] }))
      .mockResolvedValueOnce(jsonResponse({
        nowPlaying: {
          playedAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          rawArtist: "Legacy Artist",
          rawTitle: "Legacy Track",
        },
      })));
    const legacyModule = await import("../src/llm/station-facts.js");
    expect(await legacyModule.answerStationQuestion("What is playing on KEXP?"))
      .toContain("stale or unconfirmed");
  });

  it("supports recent history forms while refusing to imply bounded tracks cover a date", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ stations: [directory.stations[0]] }))
      .mockImplementation(async () => jsonResponse({
        tracks: [{
          playedAt: "2025-02-03T04:05:00.000Z",
          rawArtist: "Artist",
          rawTitle: "Track",
        }],
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { answerStationQuestion } = await moduleUnderTest();
    expect(await answerStationQuestion("What did KEXP play recently?"))
      .toContain("Artist — Track");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/stations/spins?slug=kexp&limit=5");
    expect(await answerStationQuestion("What has KEXP played?")).toContain("Artist — Track");
    expect(await answerStationQuestion("Recent spins for KEXP")).toContain("Artist — Track");
    expect(await answerStationQuestion("History for KEXP")).toContain("Artist — Track");

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ stations: [directory.stations[0]] })));
    const yesterdayModule = await import("../src/llm/station-facts.js");
    expect(await yesterdayModule.answerStationQuestion("What did KEXP play yesterday?"))
      .toContain("can’t verify that time period");
  });

  it("answers station identity and location questions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      stations: [directory.stations[0]],
    })));
    const { answerStationQuestion } = await moduleUnderTest();
    expect(await answerStationQuestion("Where is KEXP?"))
      .toContain("listed as based in Seattle");
    expect(await answerStationQuestion("What is KEXP?")).toContain("University of Washington");
  });

  it("prefilters non-station artist questions and strips URL text before matching", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ stations: [directory.stations[0]] }));
    vi.stubGlobal("fetch", fetchMock);
    const { answerStationQuestion } = await moduleUnderTest();
    expect(await answerStationQuestion("Tell me about Radiohead")).toBeNull();
    expect(await answerStationQuestion("What is Radiohead?")).toBeNull();
    expect(await answerStationQuestion("Where is https://example.org/KEXP based?")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only emits validated public http(s) homepages as safe Slack links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      stations: [{
        ...directory.stations[0],
        homepageUrl: "https://example.org/home|<@U123>",
      }],
    })));
    const { answerStationQuestion } = await moduleUnderTest();
    const answer = await answerStationQuestion("Tell me about KEXP");
    expect(answer).toContain("<https://example.org/home%7C%3C@U123%3E|Homepage>");
    expect(answer).not.toContain("home|<@U123>");

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      stations: [{
        ...directory.stations[0],
        homepageUrl: "javascript:alert(1)",
      }],
    })));
    const unsafeModule = await import("../src/llm/station-facts.js");
    const unsafeAnswer = await unsafeModule.answerStationQuestion("Tell me about KEXP");
    expect(unsafeAnswer).not.toContain("javascript:");
    expect(unsafeAnswer).toContain("University of Washington");

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      stations: [{
        ...directory.stations[0],
        homepageUrl: "http://127.0.0.1/admin",
      }],
    })));
    const privateUrlModule = await import("../src/llm/station-facts.js");
    expect(await privateUrlModule.answerStationQuestion("Tell me about KEXP"))
      .not.toContain("127.0.0.1");
  });

  it("returns explicit source failures, ignores generic Jam questions, and sends anonymous safe GETs", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "offline" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const { answerStationQuestion } = await moduleUnderTest();
    expect(await answerStationQuestion("What did we play in Jam history?")).toBeNull();
    expect(await answerStationQuestion("What did we play recently?")).toBeNull();
    expect(await answerStationQuestion("What did Jam play yesterday?")).toBeNull();
    expect(await answerStationQuestion("What is playing now?")).toBeNull();
    expect(await answerStationQuestion("Tell me about Radiohead")).toBeNull();
    expect(await answerStationQuestion("Where is KEXP based?"))
      .toContain("station directory is unavailable");
    expect(await answerStationQuestion("Tell me about KEXP radio"))
      .toContain("station directory is unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "error",
    });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers");
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("credentials");
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("does not expose private or cookie fields in answers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        stations: [{
          ...directory.stations[0],
          listenerNames: ["Private Listener"],
          cookie: "secret",
          streamUrl: "private-stream",
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        tracks: [{
          playedAt: "2025-02-03T04:05:00.000Z",
          rawArtist: "Public Artist",
          rawTitle: "Public Track",
          listenerNames: ["Private Listener"],
          cookie: "secret",
        }],
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { answerStationQuestion } = await moduleUnderTest();
    const answer = await answerStationQuestion("What did KEXP play recently?");
    expect(answer).toContain("Public Artist — Public Track");
    expect(answer).not.toContain("Private Listener");
    expect(answer).not.toContain("secret");
  });
});