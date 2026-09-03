import { db, recordingsTable, spinsTable } from "@workspace/db";
import { and, eq, isNull, notLike, sql } from "drizzle-orm";
import {
  createMbResolver,
  musicbrainzEnabled,
} from "@workspace/song-enrichment";
import { searchTrack, spotifyAppConfigured } from "../spotify/appClient.js";
import { isUsableDuration } from "./duration-evidence.js";

const BATCH_BUDGET_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 15_000;
const ACTIVE_TICK_MS = 15_000;
const IDLE_TICK_MS = 10 * 60_000;

type DurationCandidate = {
  mbid: string;
  artist: string;
  title: string;
  isrc: string | null;
};

export type DurationBackfillResult = {
  scanned: number;
  updated: number;
  noResult: number;
  failed: number;
  remaining: number;
};

const resolver = createMbResolver();
let activeBatch: Promise<DurationBackfillResult> | null = null;
let running = false;

function normalizeIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function spotifyTrackMatches(
  track: { name: string; artists: Array<{ name: string }>; isrc: string | null },
  candidate: DurationCandidate,
): boolean {
  if (candidate.isrc) {
    return track.isrc?.trim().toUpperCase() === candidate.isrc.trim().toUpperCase();
  }
  return (
    normalizeIdentity(track.name) === normalizeIdentity(candidate.title) &&
    track.artists.some(
      (artist) =>
        normalizeIdentity(artist.name) === normalizeIdentity(candidate.artist),
    )
  );
}

async function fetchSpotifyDuration(
  candidate: DurationCandidate,
): Promise<number | null> {
  if (!spotifyAppConfigured()) return null;
  const query = candidate.isrc
    ? `isrc:${candidate.isrc}`
    : `track:"${candidate.title}" artist:"${candidate.artist}"`;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
    });
    const track = await Promise.race([searchTrack(query), timeoutPromise]);
    if (!track || !spotifyTrackMatches(track, candidate)) return null;
    return isUsableDuration(track.durationMs) ? track.durationMs : null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runDurationBatch(batchSize: number): Promise<DurationBackfillResult> {
  if (batchSize <= 0) {
    return { scanned: 0, updated: 0, noResult: 0, failed: 0, remaining: 0 };
  }

  const targetWhere = and(
    isNull(recordingsTable.durationMs),
    isNull(recordingsTable.durationCheckedAt),
    notLike(recordingsTable.mbid, "sp:%"),
    sql`EXISTS (
      SELECT 1 FROM ${spinsTable}
      WHERE ${spinsTable.mbid} = ${recordingsTable.mbid}
    )`,
  );
  if (!musicbrainzEnabled() && !spotifyAppConfigured()) {
    const [remainingRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(recordingsTable)
      .where(targetWhere);
    return {
      scanned: 0,
      updated: 0,
      noResult: 0,
      failed: 0,
      remaining: remainingRow?.count ?? 0,
    };
  }
  const rows = await db
    .select({
      mbid: recordingsTable.mbid,
      artist: recordingsTable.artist,
      title: recordingsTable.title,
      isrc: recordingsTable.isrc,
    })
    .from(recordingsTable)
    .where(targetWhere)
    .orderBy(
      sql`(SELECT MAX(played_at) FROM ${spinsTable}
        WHERE ${spinsTable.mbid} = ${recordingsTable.mbid}) DESC NULLS LAST`,
    )
    .limit(batchSize);

  let updated = 0;
  let noResult = 0;
  let failed = 0;
  let scanned = 0;
  const deadline = Date.now() + BATCH_BUDGET_MS;

  for (const row of rows as DurationCandidate[]) {
    if (Date.now() > deadline) {
      console.warn("[lore] duration backfill: batch budget exceeded, stopping early");
      break;
    }
    scanned++;
    try {
      let durationMs = await resolver.fetchDuration(
        row.mbid,
        AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      );
      // MusicBrainz is canonical for this row. Spotify is only consulted when
      // MB has no length, and its result is accepted only for an exact ISRC or
      // exact normalized artist/title match.
      if (!isUsableDuration(durationMs)) {
        durationMs = await fetchSpotifyDuration(row);
      }

      await db
        .update(recordingsTable)
        .set({
          ...(durationMs != null ? { durationMs } : {}),
          durationCheckedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(recordingsTable.mbid, row.mbid));

      if (durationMs != null) updated++;
      else noResult++;
    } catch (err) {
      failed++;
      console.error("[lore] duration backfill row failed", row.mbid, err);
      // Leave duration_checked_at NULL so provider/network failures retry.
    }
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordingsTable)
    .where(targetWhere);

  return {
    scanned,
    updated,
    noResult,
    failed,
    remaining: remainingRow?.count ?? 0,
  };
}

/**
 * Run one bounded batch. Concurrent callers share the same promise, preventing
 * the admin button and the scheduled worker from double-starting a batch.
 */
export function backfillDurationBatch(
  batchSize = 20,
): Promise<DurationBackfillResult> {
  if (activeBatch) return activeBatch;
  activeBatch = runDurationBatch(batchSize).finally(() => {
    activeBatch = null;
  });
  return activeBatch;
}

export function startDurationBackfillJob(): void {
  if (running) return;
  if (!musicbrainzEnabled() && !spotifyAppConfigured()) {
    console.warn("[lore] duration backfill disabled: no metadata provider configured");
    return;
  }
  running = true;
  const tick = async () => {
    let nextMs = IDLE_TICK_MS;
    try {
      const result = await backfillDurationBatch();
      if (result.remaining > 0) nextMs = ACTIVE_TICK_MS;
    } catch (err) {
      console.error("[lore] duration backfill tick failed", err);
    }
    setTimeout(tick, nextMs);
  };
  // Let boot-time schema/seed work settle before using provider capacity.
  setTimeout(tick, ACTIVE_TICK_MS);
}