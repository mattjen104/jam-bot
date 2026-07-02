import { db, recordingsTable, spinsTable, type Station } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  resolveRecordingId,
  resolveRecordingByText,
  fetchRecordingLinks,
  type RecordingLink,
} from "@workspace/song-enrichment";
import { searchTrack } from "../spotify/appClient.js";
import type { NowPlayingRaw } from "./types.js";

/** Outcome of trying to place a now-playing track on the MusicBrainz spine. */
interface MbidResolution {
  mbid: string | null;
  confidence: "recording_id" | "isrc" | "text" | "unresolved";
  title: string;
  artist: string;
  artistMbid?: string;
  isrc?: string;
  durationMs?: number;
}

/**
 * Resolve a now-playing track to a MusicBrainz Recording ID (the spine key).
 * Preference order mirrors confidence: a source-supplied recording id (KEXP) >
 * an ISRC lookup > a scored artist+title search (Radio Paradise). Never throws.
 */
async function resolveToMbid(np: NowPlayingRaw): Promise<MbidResolution> {
  const base = { title: np.rawTitle, artist: np.rawArtist };

  if (np.recordingId) {
    return { mbid: np.recordingId, confidence: "recording_id", ...base };
  }

  if (np.isrc) {
    const mbid = await resolveRecordingId(np.isrc);
    if (mbid) {
      return { mbid, confidence: "isrc", isrc: np.isrc, ...base };
    }
  }

  const match = await resolveRecordingByText(np.rawArtist, np.rawTitle);
  if (match) {
    return {
      mbid: match.recordingId,
      confidence: "text",
      title: match.title || np.rawTitle,
      artist: match.artist || np.rawArtist,
      ...(match.artistMbid ? { artistMbid: match.artistMbid } : {}),
      ...(match.isrc ? { isrc: match.isrc } : {}),
      ...(match.durationMs != null ? { durationMs: match.durationMs } : {}),
    };
  }

  return { mbid: null, confidence: "unresolved", ...base };
}

/**
 * Best-effort cross-service deep links for a recording. When Spotify
 * client-credentials is configured we resolve an exact Spotify reference to feed
 * Odesli; otherwise it degrades to universal artist+title search links so a
 * listener can always click through. Cached per MBID inside the enrichment lib.
 */
async function resolveLinks(
  recordingId: string,
  artist: string,
  title: string,
): Promise<RecordingLink[]> {
  let spotifyTrackId: string | undefined;
  try {
    const hit = await searchTrack(`${artist} ${title}`);
    if (hit) spotifyTrackId = hit.id;
  } catch {
    // Spotify unconfigured / rate-limited — fall back to search links.
  }
  const args: Parameters<typeof fetchRecordingLinks>[0] = {
    recordingId,
    artist,
    title,
  };
  if (spotifyTrackId) args.spotifyTrackId = spotifyTrackId;
  const links = await fetchRecordingLinks(args);
  return links?.platforms ?? [];
}

/** Signature used to detect whether the on-air track actually changed. */
function sig(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}\u0000${title.toLowerCase().trim()}`;
}

/**
 * Given a station's freshly-fetched now-playing metadata, log a spin *iff* the
 * on-air track changed since the last logged spin. Resolves the MBID, upserts
 * the recording (with links + artwork), and inserts the spin against the spine.
 * Returns true when a new spin was logged. Never throws — the poller relies on
 * this being safe.
 */
export async function logSpinIfChanged(
  station: Station,
  np: NowPlayingRaw,
): Promise<boolean> {
  try {
    // 1. Change detection against the most recent spin for this station.
    const [last] = await db
      .select({ rawArtist: spinsTable.rawArtist, rawTitle: spinsTable.rawTitle })
      .from(spinsTable)
      .where(eq(spinsTable.stationId, station.id))
      .orderBy(desc(spinsTable.playedAt))
      .limit(1);
    if (
      last &&
      last.rawArtist &&
      last.rawTitle &&
      sig(last.rawArtist, last.rawTitle) === sig(np.rawArtist, np.rawTitle)
    ) {
      return false;
    }

    // 2. Resolve to the MBID spine.
    const r = await resolveToMbid(np);

    // 3. Upsert the recording node + links (only fetch links when missing).
    if (r.mbid) {
      const [existing] = await db
        .select({ mbid: recordingsTable.mbid, links: recordingsTable.links })
        .from(recordingsTable)
        .where(eq(recordingsTable.mbid, r.mbid))
        .limit(1);

      let links = existing?.links ?? null;
      if (!links || links.length === 0) {
        const fetched = await resolveLinks(r.mbid, r.artist, r.title);
        links = fetched.length ? fetched : null;
      }

      await db
        .insert(recordingsTable)
        .values({
          mbid: r.mbid,
          title: r.title,
          artist: r.artist,
          artistMbid: r.artistMbid ?? null,
          isrc: r.isrc ?? null,
          durationMs: r.durationMs ?? null,
          artworkUrl: np.artworkUrl ?? null,
          links,
        })
        .onConflictDoUpdate({
          target: recordingsTable.mbid,
          set: {
            title: r.title,
            artist: r.artist,
            artistMbid: r.artistMbid ?? null,
            ...(r.isrc ? { isrc: r.isrc } : {}),
            ...(np.artworkUrl ? { artworkUrl: np.artworkUrl } : {}),
            ...(links ? { links } : {}),
            updatedAt: sql`now()`,
          },
        });
    }

    // 4. Log the spin against the spine (mbid null when unresolved — honest).
    await db.insert(spinsTable).values({
      stationId: station.id,
      mbid: r.mbid,
      rawArtist: np.rawArtist,
      rawTitle: np.rawTitle,
      source: station.nowPlayingSource ?? null,
      confidence: r.confidence,
    });

    return true;
  } catch (err) {
    console.error("[lore] logSpinIfChanged failed", station.slug, err);
    return false;
  }
}
