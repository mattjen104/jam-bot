import { describe, expect, it } from "vitest";
import {
  extractSpotifyTrackId,
  trackIdFromUri,
  SPOTIFY_SCOPES,
} from "../src/lore/spotifyConnect.js";
import type { RecordingLink } from "@workspace/db";

describe("extractSpotifyTrackId", () => {
  it("returns null for missing or empty links", () => {
    expect(extractSpotifyTrackId(null)).toBeNull();
    expect(extractSpotifyTrackId(undefined)).toBeNull();
    expect(extractSpotifyTrackId([])).toBeNull();
  });

  it("extracts the track id from an exact Spotify link", () => {
    const links: RecordingLink[] = [
      { name: "Apple Music", url: "https://music.apple.com/us/album/x", kind: "exact" },
      {
        name: "Spotify",
        url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        kind: "exact",
      },
    ];
    expect(extractSpotifyTrackId(links)).toBe("4uLU6hMCjMI75M1A2tKUQC");
  });

  it("handles query strings and locale prefixes in the URL", () => {
    const links: RecordingLink[] = [
      {
        name: "Spotify",
        url: "https://open.spotify.com/track/7azo4rpSUh8nXgtonC6Pkq?si=abc123",
        kind: "exact",
      },
    ];
    expect(extractSpotifyTrackId(links)).toBe("7azo4rpSUh8nXgtonC6Pkq");
  });

  it("ignores search-kind Spotify links (guesses are not identity)", () => {
    const links: RecordingLink[] = [
      {
        name: "Spotify",
        url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        kind: "search",
      },
    ];
    expect(extractSpotifyTrackId(links)).toBeNull();
  });

  it("ignores non-track Spotify links (albums, artists)", () => {
    const links: RecordingLink[] = [
      {
        name: "Spotify",
        url: "https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE",
        kind: "exact",
      },
      {
        name: "Spotify",
        url: "https://open.spotify.com/artist/0YC192cP3KPCRWx8zr8MfZ",
        kind: "exact",
      },
    ];
    expect(extractSpotifyTrackId(links)).toBeNull();
  });
});

describe("trackIdFromUri", () => {
  it("extracts the id from a track URI", () => {
    expect(trackIdFromUri("spotify:track:4uLU6hMCjMI75M1A2tKUQC")).toBe(
      "4uLU6hMCjMI75M1A2tKUQC",
    );
  });

  it("rejects non-track URIs and junk", () => {
    expect(trackIdFromUri("spotify:album:6dVIqQ8qmQ5GBnJ9shOYGE")).toBeNull();
    expect(trackIdFromUri("spotify:artist:0YC192cP3KPCRWx8zr8MfZ")).toBeNull();
    expect(trackIdFromUri("https://open.spotify.com/track/abc")).toBeNull();
    expect(trackIdFromUri("")).toBeNull();
    // Trailing garbage must not sneak through into an API call.
    expect(trackIdFromUri("spotify:track:abc def")).toBeNull();
  });
});

describe("SPOTIFY_SCOPES", () => {
  it("includes the library scopes the heart button depends on", () => {
    const scopes = SPOTIFY_SCOPES.split(" ");
    expect(scopes).toContain("user-library-read");
    expect(scopes).toContain("user-library-modify");
  });
});
