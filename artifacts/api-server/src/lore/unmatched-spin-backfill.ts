import {
  db,
  recordingsTable,
  resolutionCacheTable,
  spinsTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { createMbResolver, musicbrainzEnabled } from "@workspace/song-enrichment";
import { isJunkMetadata } from "./icy.js";
import { normalizeKey, upsertRecording } from "./resolve.js";

/**
 * Converges recent station spins that were logged before MusicBrainz could
 * identify them. This is intentionally separate from live ingestion:
 * resolution happens from a bounded snapshot, and only a scored canonical
 * MusicBrainz match is promoted onto the spine.
 *
 * Resolution-cache states:
 *   - no row: candidate has not been attempted
 *   - unresolved: MusicBrainz gave a clear miss; never retry
 *   - deferred: provider/network failure; retry after DEFERRED_RETRY_MS
 *   - text/isrc: canonical match; attach the waiting spins without a lookup
 */

const resolver = createMbResolver();
const RECENT_WINDOW_DAYS = 30;
const BATCH_SIZE = 20;
const SCAN_LIMIT = 2_000;
const LOOKUP_TIMEOUT_MS = 15_000;
const BATCH_BUDGET_MS = 60_000;
const ACTIVE_TICK_MS = 15_000;
const IDLE_TICK_MS = 10 * 60_000;
const DEFERRED_RETRY_MS = 15 * 60_000;

type CacheRow = {
  key: string;
  mbid: string | null;
  confidence: string;
  updatedAt: Date | null;
};

type Candidate = {
  key: string;
  artist: string;
  title: string;
  spinIds: number[];
  hasResolvedSpin: boolean;
  cached?: CacheRow;
};

export interface UnmatchedSpinBackfillResult {
  candidates: number;
  /** Alias retained for admin callers that describe work as scanned rows. */
  scanned: number;
  resolved: number;
  deferred: number;
  unavailable: number;
  remaining: number;
  skipped?: boolean;
}

export interface UnmatchedSpinHealth {
  candidates: number;
  resolved: number;
  deferred: number;
  unavailable: number;
  lastAttemptAt: string | null;
}

function recentSince(): Date {
  return new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function retryableDeferred(row: CacheRow): boolean {
  return (
    row.confidence === "deferred" &&
    (!row.updatedAt || Date.now() - row.updatedAt.getTime() >= DEFERRED_RETRY_MS)
  );
}

function usablePair(artist: string | null, title: string | null): boolean {
  const a = artist?.trim() ?? "";
  const t = title?.trim() ?? "";
  return Boolean(a && t) && !isJunkMetadata(a, t);
}

async function readRecentRows(unresolvedOnly = false) {
  return db
    .select({
      id: spinsTable.id,
      mbid: spinsTable.mbid,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      playedAt: spinsTable.playedAt,
    })
    .from(spinsTable)
    .where(
      and(
        gte(spinsTable.playedAt, recentSince()),
        isNotNull(spinsTable.rawArtist),
        isNotNull(spinsTable.rawTitle),
        unresolvedOnly ? isNull(spinsTable.mbid) : undefined,
      ),
    )
    .orderBy(desc(spinsTable.playedAt), desc(spinsTable.id))
    .limit(SCAN_LIMIT);
}

function groupRows(
  rows: Array<{
    id: number;
    mbid: string | null;
    rawArtist: string | null;
    rawTitle: string | null;
  }>,
  unresolvedOnly: boolean,
): Map<string, Candidate> {
  const groups = new Map<string, Candidate>();
  for (const row of rows) {
    if (unresolvedOnly && row.mbid !== null) continue;
    if (!usablePair(row.rawArtist, row.rawTitle)) continue;
    const artist = row.rawArtist!.trim();
    const title = row.rawTitle!.trim();
    const key = normalizeKey(artist, title);
    const existing = groups.get(key);
    if (existing) {
      existing.spinIds.push(row.id);
      if (row.mbid !== null && !row.mbid.startsWith("sp:")) {
        existing.hasResolvedSpin = true;
      }
    } else {
      groups.set(key, {
        key,
        artist,
        title,
        spinIds: [row.id],
        hasResolvedSpin: row.mbid !== null && !row.mbid.startsWith("sp:"),
      });
    }
  }
  return groups;
}

async function readCache(keys: string[]): Promise<Map<string, CacheRow>> {
  if (!keys.length) return new Map();
  const rows = await db
    .select({
      key: resolutionCacheTable.key,
      mbid: resolutionCacheTable.mbid,
      confidence: resolutionCacheTable.confidence,
      updatedAt: resolutionCacheTable.updatedAt,
    })
    .from(resolutionCacheTable)
    .where(inArray(resolutionCacheTable.key, keys));
  return new Map(rows.map((row) => [row.key, row]));
}

async function writeCache(
  key: string,
  mbid: string | null,
  confidence: "text" | "unresolved" | "deferred",
): Promise<void> {
  await db
    .insert(resolutionCacheTable)
    .values({ key, mbid, confidence, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: resolutionCacheTable.key,
      set: { mbid, confidence, updatedAt: new Date() },
    });
}

async function attachSpins(candidate: Candidate, mbid: string): Promise<number> {
  const updated = await db
    .update(spinsTable)
    .set({ mbid, confidence: "text" })
    .where(and(inArray(spinsTable.id, candidate.spinIds), isNull(spinsTable.mbid)))
    .returning({ id: spinsTable.id });
  return updated.length;
}

async function enrichReleaseFacts(mbid: string): Promise<void> {
  try {
    const info = await resolver.fetchReleaseDateInfo(
      mbid,
      AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    );
    if (!info) return;
    await db
      .update(recordingsTable)
      .set({
        ...(info.year != null ? { releaseYear: info.year } : {}),
        ...(info.releaseDate != null ? { releaseDate: info.releaseDate } : {}),
        ...(info.year != null || info.releaseDate != null
          ? { yearCheckedAt: sql`now()`, releaseDateCheckedAt: sql`now()` }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(recordingsTable.mbid, mbid));
  } catch (err) {
    // The recording and its spins are already safely promoted. The existing
    // release-year job will retry release facts independently.
    console.warn("[lore] unmatched-spin release metadata deferred", mbid, err);
  }
}

export async function getUnmatchedSpinHealth(): Promise<UnmatchedSpinHealth> {
  try {
    const rows = await readRecentRows();
    const groups = groupRows(rows, false);
    const cache = await readCache([...groups.keys()]);
    let resolved = 0;
    let deferred = 0;
    let unavailable = 0;
    let candidates = 0;
    let lastAttemptMs = 0;

    for (const candidate of groups.values()) {
      const cached = cache.get(candidate.key);
      if (cached?.updatedAt) {
        lastAttemptMs = Math.max(lastAttemptMs, cached.updatedAt.getTime());
      }
      if (candidate.hasResolvedSpin) {
        resolved++;
      } else if (cached?.confidence === "deferred") {
        deferred++;
      } else if (
        cached?.confidence === "unresolved" ||
        cached?.confidence === "spotify"
      ) {
        unavailable++;
      } else {
        candidates++;
      }
    }

    return {
      candidates,
      resolved,
      deferred,
      unavailable,
      lastAttemptAt: lastAttemptMs ? new Date(lastAttemptMs).toISOString() : null,
    };
  } catch (err) {
    console.error("[lore] unmatched-spin health read failed", err);
    return {
      candidates: 0,
      resolved: 0,
      deferred: 0,
      unavailable: 0,
      lastAttemptAt: null,
    };
  }
}

export async function backfillUnmatchedSpinsBatch(
  batchSize = BATCH_SIZE,
): Promise<UnmatchedSpinBackfillResult> {
  if (batchRunning) {
    return {
      candidates: 0,
      scanned: 0,
      resolved: 0,
      deferred: 0,
      unavailable: 0,
      remaining: 0,
      skipped: true,
    };
  }
  batchRunning = true;
  try {
    const rows = await readRecentRows(true);
    const groups = groupRows(rows, true);
    const cache = await readCache([...groups.keys()]);
    const candidates = [...groups.values()]
      .map((candidate) => {
        const cached = cache.get(candidate.key);
        return cached ? { ...candidate, cached } : candidate;
      })
      .filter(
        (candidate) =>
          !candidate.cached ||
          (Boolean(candidate.cached.mbid) &&
            !candidate.cached.mbid!.startsWith("sp:")) ||
          retryableDeferred(candidate.cached),
      )
      .slice(0, Math.max(1, batchSize));

    let resolved = 0;
    let deferred = 0;
    let unavailable = 0;
    const deadline = Date.now() + BATCH_BUDGET_MS;

    for (const candidate of candidates) {
      if (Date.now() > deadline) break;
      let mbid = candidate.cached?.mbid ?? null;
      if (!mbid || mbid.startsWith("sp:")) {
        try {
          const result = await resolver.resolveByTextWithScoreStatus(
            candidate.artist,
            candidate.title,
            AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
          );
          if (result.status === "deferred") {
            await writeCache(candidate.key, null, "deferred");
            deferred++;
            continue;
          }
          mbid = result.status === "matched" && result.score >= 90 ? result.mbid : null;
        } catch (err) {
          await writeCache(candidate.key, null, "deferred");
          deferred++;
          console.warn(
            "[lore] unmatched-spin MusicBrainz lookup deferred",
            candidate.artist,
            candidate.title,
            err,
          );
          continue;
        }
      }

      if (!mbid || mbid.startsWith("sp:")) {
        await writeCache(candidate.key, null, "unresolved");
        unavailable++;
        continue;
      }

      await upsertRecording(
        {
          mbid,
          confidence: "text",
          artist: candidate.artist,
          title: candidate.title,
          fromCache: Boolean(candidate.cached?.mbid),
        },
        undefined,
        false,
      );
      await attachSpins(candidate, mbid);
      await writeCache(candidate.key, mbid, "text");
      await enrichReleaseFacts(mbid);
      resolved++;
    }

    const health = await getUnmatchedSpinHealth();
    return {
      candidates: candidates.length,
      scanned: candidates.length,
      resolved,
      deferred,
      unavailable,
      remaining: health.candidates,
    };
  } finally {
    batchRunning = false;
  }
}

let batchRunning = false;
let jobRunning = false;
let timer: NodeJS.Timeout | null = null;

export function startUnmatchedSpinBackfillJob(): void {
  if (jobRunning) return;
  if (!musicbrainzEnabled()) {
    console.warn("[lore] unmatched-spin backfill disabled: MusicBrainz not configured");
    return;
  }
  jobRunning = true;
  const tick = async () => {
    let nextMs = IDLE_TICK_MS;
    try {
      const result = await backfillUnmatchedSpinsBatch();
      if (result.remaining > 0 || result.deferred > 0) nextMs = ACTIVE_TICK_MS;
    } catch (err) {
      console.error("[lore] unmatched-spin backfill tick failed", err);
    }
    if (jobRunning) timer = setTimeout(tick, nextMs);
  };
  timer = setTimeout(tick, ACTIVE_TICK_MS);
}

export function stopUnmatchedSpinBackfillJob(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  jobRunning = false;
}