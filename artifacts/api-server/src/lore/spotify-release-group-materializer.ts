import {
  db,
  libraryItemsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  releaseGroupProviderMappingsTable,
  releaseGroupProviderTracksTable,
  type RecordingLink,
} from "@workspace/db";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { getAlbumTracksComplete, getTrackById } from "../spotify/appClient.js";
import { validProviderExternalUrl } from "./provider-playback.js";

export interface SpotifyMaterializationPlan {
  releaseGroupMbid: string;
  albumId: string;
  albumUrl: string;
  tracks: Array<{ recordingMbid: string; providerTrackId: string; providerTrackUrl: string; position: number }>;
}
export type MaterializationResult = "inserted" | "promoted" | "unchanged" | "conflict" | "skipped";
export interface SpotifyMaterializerFetchers {
  getTrackById: typeof getTrackById;
  getAlbumTracks: typeof getAlbumTracksComplete;
}

export function exactSpotifyTrackId(links: RecordingLink[] | null | undefined): string | null {
  const exact = (links ?? []).filter((link) => link.kind === "exact" && /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}$/.test(link.url));
  return exact.length === 1 ? exact[0].url.split("/").pop()! : null;
}

export function planSpotifyMaterialization(
  releaseGroupMbid: string,
  recordings: Array<{ recordingMbid: string; links: RecordingLink[] | null }>,
  seed: { id: string; albumId: string | null },
  albumTracks: Array<{ id: string; trackNumber: number }>,
): SpotifyMaterializationPlan | null {
  const local = recordings.map((row) => ({ ...row, id: exactSpotifyTrackId(row.links) }));
  if (local.some((row) => !row.id) || !seed.albumId || !/^[A-Za-z0-9]{22}$/.test(seed.albumId)) return null;
  const ids = local.map((row) => row.id!);
  const apiIds = albumTracks.map((track) => track.id);
  if (new Set(ids).size !== ids.length || new Set(apiIds).size !== apiIds.length) return null;
  if (ids.length !== apiIds.length || ids.some((id) => !apiIds.includes(id))) return null;
  return {
    releaseGroupMbid,
    albumId: seed.albumId,
    albumUrl: `https://open.spotify.com/album/${seed.albumId}`,
    tracks: albumTracks.map((track, index) => ({
      recordingMbid: local.find((row) => row.id === track.id)!.recordingMbid,
      providerTrackId: track.id,
      providerTrackUrl: `https://open.spotify.com/track/${track.id}`,
      position: index + 1,
    })),
  };
}

export async function materializeSpotifyReleaseGroup(
  releaseGroupMbid: string,
  recordings: Array<{ recordingMbid: string; links: RecordingLink[] | null }>,
  fetchers: SpotifyMaterializerFetchers = { getTrackById, getAlbumTracks: getAlbumTracksComplete },
): Promise<MaterializationResult> {
  const seedId = exactSpotifyTrackId(recordings[0]?.links);
  if (!seedId) return "skipped";
  const seed = await fetchers.getTrackById(seedId);
  if (!seed || seed.id !== seedId || !seed.albumId || !/^[A-Za-z0-9]{22}$/.test(seed.albumId)) return "skipped";
  const albumResult = await fetchers.getAlbumTracks(seed.albumId);
  if (!albumResult.complete || albumResult.tracks.length !== albumResult.total) return "skipped";
  const plan = planSpotifyMaterialization(releaseGroupMbid, recordings, seed, albumResult.tracks);
  if (!plan || !validProviderExternalUrl({ id: 0, provider: "spotify", providerAlbumId: plan.albumId, externalUrl: plan.albumUrl, officialEmbedUrl: null, confidence: "exact", verification: "verified", deadLink: false })) return "skipped";
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(releaseGroupProviderMappingsTable).where(and(eq(releaseGroupProviderMappingsTable.releaseGroupMbid, releaseGroupMbid), eq(releaseGroupProviderMappingsTable.provider, "spotify"))).limit(1);
    if (existing && (existing.providerAlbumId !== plan.albumId || existing.externalUrl !== plan.albumUrl)) return "conflict";
    if (existing) {
      const prior = await tx.select({
        recordingMbid: releaseGroupProviderTracksTable.recordingMbid,
        providerTrackId: releaseGroupProviderTracksTable.providerTrackId,
        position: releaseGroupProviderTracksTable.position,
        confidence: releaseGroupProviderTracksTable.confidence,
        verification: releaseGroupProviderTracksTable.verification,
        deadLink: releaseGroupProviderTracksTable.deadLink,
      }).from(releaseGroupProviderTracksTable).where(eq(releaseGroupProviderTracksTable.mappingId, existing.id));
      if (prior.length > 0 && (
        prior.length !== plan.tracks.length ||
        prior.some((row) => !plan.tracks.some((track) =>
          track.recordingMbid === row.recordingMbid &&
          track.providerTrackId === row.providerTrackId &&
          track.position === row.position,
        ))
      )) return "conflict";
      const healthy = existing.confidence === "exact" &&
        existing.verification === "verified" &&
        !existing.deadLink &&
        prior.length === plan.tracks.length &&
        prior.every((row) => row.confidence === "exact" && row.verification === "verified" && !row.deadLink);
      if (healthy) return "unchanged";
    }
    const [mapping] = existing
      ? await tx.update(releaseGroupProviderMappingsTable).set({ providerAlbumId: plan.albumId, externalUrl: plan.albumUrl, confidence: "exact", verification: "verified", deadLink: false, lastVerifiedAt: new Date(), provenance: { kind: "exact_local_spotify_track_links", verifiedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(releaseGroupProviderMappingsTable.id, existing.id)).returning()
      : await tx.insert(releaseGroupProviderMappingsTable).values({ releaseGroupMbid, provider: "spotify", providerAlbumId: plan.albumId, externalUrl: plan.albumUrl, confidence: "exact", verification: "verified", deadLink: false, lastVerifiedAt: new Date(), provenance: { kind: "exact_local_spotify_track_links", verifiedAt: new Date().toISOString() } }).returning();
    await tx.delete(releaseGroupProviderTracksTable).where(eq(releaseGroupProviderTracksTable.mappingId, mapping.id));
    await tx.insert(releaseGroupProviderTracksTable).values(plan.tracks.map((track) => ({ ...track, mappingId: mapping.id, confidence: "exact", verification: "verified", deadLink: false, lastVerifiedAt: new Date() })));
    return existing ? "promoted" : "inserted";
  });
}

let running = false;
const attemptedAt = new Map<string, number>();
const ATTEMPT_COOLDOWN_MS = 6 * 60 * 60_000;
export async function runSpotifyReleaseGroupBackfill(limit = 4): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    for (const [releaseGroupMbid, attempted] of attemptedAt) {
      if (now - attempted >= ATTEMPT_COOLDOWN_MS) attemptedAt.delete(releaseGroupMbid);
    }
    const cooling = [...attemptedAt.keys()];
    const groups = await db.select({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
      .from(recordingReleaseGroupsTable)
      .innerJoin(libraryItemsTable, eq(libraryItemsTable.mbid, recordingReleaseGroupsTable.recordingMbid))
      .leftJoin(releaseGroupProviderMappingsTable, and(eq(releaseGroupProviderMappingsTable.releaseGroupMbid, recordingReleaseGroupsTable.releaseGroupMbid), eq(releaseGroupProviderMappingsTable.provider, "spotify"), eq(releaseGroupProviderMappingsTable.verification, "verified"), eq(releaseGroupProviderMappingsTable.deadLink, false)))
      .where(and(
        isNull(libraryItemsTable.removedAt),
        isNull(releaseGroupProviderMappingsTable.id),
        cooling.length
          ? notInArray(recordingReleaseGroupsTable.releaseGroupMbid, cooling)
          : undefined,
      ))
      .groupBy(recordingReleaseGroupsTable.releaseGroupMbid).limit(limit);
    for (const group of groups) {
      const lastAttempt = attemptedAt.get(group.releaseGroupMbid) ?? 0;
      if (Date.now() - lastAttempt < ATTEMPT_COOLDOWN_MS) continue;
      attemptedAt.set(group.releaseGroupMbid, Date.now());
      const rows = await db.select({ recordingMbid: recordingsTable.mbid, links: recordingsTable.links }).from(recordingReleaseGroupsTable).innerJoin(recordingsTable, eq(recordingsTable.mbid, recordingReleaseGroupsTable.recordingMbid)).where(eq(recordingReleaseGroupsTable.releaseGroupMbid, group.releaseGroupMbid));
      try { await materializeSpotifyReleaseGroup(group.releaseGroupMbid, rows); } catch { /* cooldown covers transient failures */ }
    }
  } finally { running = false; }
}