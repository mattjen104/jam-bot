import { describe, expect, it } from "vitest";
import { materializeSpotifyReleaseGroup, planSpotifyMaterialization } from "../src/lore/spotify-release-group-materializer.js";

const id = "4uLU6hMCjMI75M1A2tKUQC";
const link = (value: string) => [{ name: "Spotify", url: value, kind: "exact" as const }];

describe("Spotify release-group materialization planning", () => {
  it("requires complete one-to-one local/API track evidence", () => {
    const plan = planSpotifyMaterialization("rg", [
      { recordingMbid: "r1", links: link(`https://open.spotify.com/track/${id}`) },
    ], { id, albumId: id }, [{ id, trackNumber: 1 }]);
    expect(plan?.tracks[0].position).toBe(1);
  });

  it("rejects missing, duplicate, or extra API tracks", () => {
    expect(planSpotifyMaterialization("rg", [
      { recordingMbid: "r1", links: link(`https://open.spotify.com/track/${id}`) },
    ], { id, albumId: id }, [])).toBeNull();
  });

  it("skips an incomplete paginated provider result", async () => {
    const result = await materializeSpotifyReleaseGroup("no-db-needed", [
      { recordingMbid: "r1", links: link(`https://open.spotify.com/track/${id}`) },
    ], {
      getTrackById: async () => ({ id, albumId: id } as never),
      getAlbumTracks: async () => ({ tracks: [], total: 51, complete: false }),
    });
    expect(result).toBe("skipped");
  });
});