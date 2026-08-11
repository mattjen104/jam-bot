import { describe, it, expect } from "vitest";
import { resolvePlaybackSource } from "../src/hooks/useRadioPlayer";
import type { Station } from "@workspace/api-client-react";

function station(overrides: Partial<Station>): Station {
  return {
    id: 1,
    slug: "test",
    name: "Test Station",
    org: null,
    city: null,
    country: null,
    streamUrl: "",
    streamQuality: null,
    streamFormat: "mp3",
    mode: "live",
    homepageUrl: null,
    donateUrl: null,
    logoUrl: null,
    attribution: false,
    tags: null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    ...overrides,
  } as Station;
}

describe("resolvePlaybackSource", () => {
  it("uses the direct stream when it is HTTPS", () => {
    const s = station({ streamUrl: "https://stream.example.org/live" });
    expect(resolvePlaybackSource(s)).toBe("https://stream.example.org/live");
  });

  it("ignores the relay when the direct stream is HTTPS", () => {
    const s = station({
      streamUrl: "https://stream.example.org/live",
      relayUrl: "/api/stations/test/relay",
    });
    expect(resolvePlaybackSource(s)).toBe("https://stream.example.org/live");
  });

  it("uses the relay when the direct stream is plain HTTP", () => {
    const s = station({
      streamUrl: "http://icecast.example.org:8000/stream",
      relayUrl: "/api/stations/test/relay",
    });
    expect(resolvePlaybackSource(s)).toBe("/api/stations/test/relay");
  });

  it("falls back to the raw HTTP stream when no relay exists", () => {
    // Non-allowlisted HTTP station: the browser may block it as mixed
    // content, but there is nothing better to try.
    const s = station({ streamUrl: "http://icecast.example.org:8000/stream" });
    expect(resolvePlaybackSource(s)).toBe("http://icecast.example.org:8000/stream");
  });

  it("uses the relay when there is no direct stream at all", () => {
    const s = station({ streamUrl: "", relayUrl: "/api/stations/test/relay" });
    expect(resolvePlaybackSource(s)).toBe("/api/stations/test/relay");
  });

  it("returns null when the station has no source", () => {
    expect(resolvePlaybackSource(station({}))).toBeNull();
    expect(resolvePlaybackSource(station({ relayUrl: null }))).toBeNull();
  });
});
