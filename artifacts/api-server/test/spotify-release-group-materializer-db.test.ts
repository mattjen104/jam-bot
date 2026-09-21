import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  recordingsTable,
  recordingReleaseGroupsTable,
  releaseGroupProviderMappingsTable,
  releaseGroupProviderTracksTable,
} from "@workspace/db";
import { materializeSpotifyReleaseGroup } from "../src/lore/spotify-release-group-materializer.js";
import { projectProviderPlayback } from "../src/lore/provider-playback.js";

const group = `test-spotify-rg-${Date.now()}`;
const track = "4uLU6hMCjMI75M1A2tKUQC";
const album = "1A2B3C4D5E6F7G8H9I0J1K";
let available = false;

describe("Spotify release-group materializer DB integration", () => {
  beforeAll(async () => {
    try { await db.execute(sql`select 1`); available = true; } catch { return; }
    await db.insert(recordingsTable).values({
      mbid: `${group}-track`, title: "Track", artist: "Artist",
      links: [{ name: "Spotify", url: `https://open.spotify.com/track/${track}`, kind: "exact" }],
    });
    await db.insert(recordingReleaseGroupsTable).values({
      recordingMbid: `${group}-track`, releaseGroupMbid: group, isPrimary: true, title: "Album",
    });
  });
  afterAll(async () => {
    if (!available) return;
    await db.delete(releaseGroupProviderMappingsTable).where(eq(releaseGroupProviderMappingsTable.releaseGroupMbid, group));
    await db.delete(recordingReleaseGroupsTable).where(eq(recordingReleaseGroupsTable.releaseGroupMbid, group));
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, `${group}-track`));
  });
  it("writes rows that project through the album provider read model", async () => {
    if (!available) return;
    const result = await materializeSpotifyReleaseGroup(group, [{
      recordingMbid: `${group}-track`,
      links: [{ name: "Spotify", url: `https://open.spotify.com/track/${track}`, kind: "exact" }],
    }], {
      getTrackById: async () => ({ id: track, albumId: album } as never),
      getAlbumTracks: async () => ({ tracks: [{ id: track, trackNumber: 1, name: "Track", isrc: null }], total: 1, complete: true }),
    });
    expect(result).toBe("inserted");
    const [mapping] = await db.select().from(releaseGroupProviderMappingsTable).where(and(eq(releaseGroupProviderMappingsTable.releaseGroupMbid, group), eq(releaseGroupProviderMappingsTable.provider, "spotify")));
    const tracks = await db.select().from(releaseGroupProviderTracksTable).where(eq(releaseGroupProviderTracksTable.mappingId, mapping.id));
    const projected = projectProviderPlayback([mapping], tracks, false);
    expect(projected.spotify.capability).toBe("embed");
    expect(projected.spotify.embedUrl).toBe(`https://open.spotify.com/embed/album/${album}`);
  });
});