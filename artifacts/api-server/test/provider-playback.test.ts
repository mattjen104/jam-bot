import { describe, expect, it } from "vitest";
import { projectProviderPlayback } from "../src/lore/provider-playback.js";

const fact = (id: number, provider: string) => ({
  id,
  provider,
  providerAlbumId: provider === "appleMusic" || provider === "bandcamp"
    ? "123"
    : provider === "spotify"
      ? "4uLU6hMCjMI75M1A2tKUQC"
      : `${provider}-album`,
  externalUrl: provider === "spotify"
    ? "https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC"
    : provider === "appleMusic"
      ? "https://music.apple.com/us/album/album/123"
      : provider === "bandcamp"
        ? "https://artist.bandcamp.com/album/album"
        : "https://www.qobuz.com/us-en/album/album/123",
  officialEmbedUrl: null,
  confidence: "exact",
  verification: "verified",
  deadLink: false,
});

describe("provider playback projection", () => {
  it("only includes exact verified tracks belonging to the Apple mapping", () => {
    const result = projectProviderPlayback(
      [fact(1, "appleMusic"), fact(2, "spotify")],
      [
        { mappingId: 1, recordingMbid: "a", providerTrackId: "101", providerTrackUrl: "https://music.apple.com/us/album/x/123?i=101", position: 1, confidence: "exact", verification: "verified", deadLink: false },
        { mappingId: 2, recordingMbid: "b", providerTrackId: "b1", providerTrackUrl: "https://b", position: 1, confidence: "exact", verification: "verified", deadLink: false },
      ],
      false,
    );
    expect(result.appleMusic.tracks?.map((track) => track.recordingMbid)).toEqual(["a"]);
  });

  it("rejects unsafe or provider-mismatched URLs without exposing them", () => {
    const result = projectProviderPlayback([{
      ...fact(1, "spotify"),
      externalUrl: "https://evil.example/album/4uLU6hMCjMI75M1A2tKUQC",
    }], [], false);
    expect(result.spotify).toEqual({
      capability: "unavailable",
      reason: "No exact, verified, live provider mapping is available.",
    });
    expect(JSON.stringify(result)).not.toContain("evil.example");
  });

  it("allows only Bandcamp album embeds, never track embeds", () => {
    const album = projectProviderPlayback([{
      ...fact(1, "bandcamp"),
      officialEmbedUrl: "https://bandcamp.com/EmbeddedPlayer/album=123/",
    }], [], false);
    expect(album.bandcamp.capability).toBe("embed");
    const track = projectProviderPlayback([{
      ...fact(1, "bandcamp"),
      officialEmbedUrl: "https://bandcamp.com/EmbeddedPlayer/track=123/",
    }], [], false);
    expect(track.bandcamp.capability).toBe("external_only");
    expect(track.bandcamp.embedUrl).toBeUndefined();
  });

  it("never leaks tokens into album capability output", () => {
    const result = projectProviderPlayback([fact(1, "spotify")], [], true);
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });

  it("always derives the Spotify embed from the verified album id", () => {
    const result = projectProviderPlayback([{
      ...fact(1, "spotify"),
      officialEmbedUrl: "https://evil.example/player",
    }], [], false);
    expect(result.spotify.embedUrl).toBe(
      "https://open.spotify.com/embed/album/4uLU6hMCjMI75M1A2tKUQC",
    );
    expect(JSON.stringify(result)).not.toContain("evil.example");
  });

  it("requires a complete contiguous Apple album mapping", () => {
    const apple = fact(1, "appleMusic");
    const tracks = [
      { mappingId: 1, recordingMbid: "a", providerTrackId: "101", providerTrackUrl: "https://music.apple.com/us/album/x/123?i=101", position: 1, confidence: "exact", verification: "verified", deadLink: false },
      { mappingId: 1, recordingMbid: "b", providerTrackId: "102", providerTrackUrl: "https://music.apple.com/us/album/x/123?i=102", position: 2, confidence: "exact", verification: "verified", deadLink: false },
    ];
    expect(projectProviderPlayback([apple], tracks, false, ["a", "b"]).appleMusic.capability)
      .toBe("full_authenticated_playback");
    expect(projectProviderPlayback([apple], tracks.slice(0, 1), false, ["a", "b"]).appleMusic.capability)
      .toBe("external_only");
    expect(projectProviderPlayback([apple], [{ ...tracks[1], position: 3 }, tracks[0]], false, ["a", "b"]).appleMusic.capability)
      .toBe("external_only");
  });

  it("rejects Apple tracks from a different album", () => {
    const apple = fact(1, "appleMusic");
    const wrongAlbumTrack = {
      mappingId: 1,
      recordingMbid: "a",
      providerTrackId: "101",
      providerTrackUrl: "https://music.apple.com/us/album/wrong/999?i=101",
      position: 1,
      confidence: "exact",
      verification: "verified",
      deadLink: false,
    };
    expect(
      projectProviderPlayback([apple], [wrongAlbumTrack], false, ["a"]).appleMusic.capability,
    ).toBe("external_only");
  });
});