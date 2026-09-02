import {
  db,
  resolutionCacheTable,
  spinsTable,
} from "@workspace/db";
import type { RecordingTextMatch } from "@workspace/song-enrichment";
import {
  and,
  desc,
  gte,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { createMbResolver, musicbrainzEnabled } from "@workspace/song-enrichment";
import { isJunkMetadata } from "./icy.js";
import { normalizeKey, resolveTextWithVariants, upsertRecording } from "./resolve.js";

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
  durationHints: number[];
  hasResolvedSpin: boolean;
  cached?: CacheRow;
  canonical?: RecordingTextMatch;
};

export interface UnmatchedSpinBackfillResult {
  candidates: number;
  /** Alias retained for admin callers that describe work as scanned rows. */
  scanned: number;
  /** Candidates actually attempted in this bounded run. */
  attempted: number;
  resolved: number;
  deferred: number;
  unavailable: number;
  /** Definitive MusicBrainz misses; alias of unavailable for older callers. */
  definitiveMiss: number;
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
      durationMs: spinsTable.durationMs,
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
    durationMs?: number | null;
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
      if (row.durationMs != null && row.durationMs > 0) {
        existing.durationHints.push(row.durationMs);
      }
      if (row.mbid !== null && !row.mbid.startsWith("sp:")) {
        existing.hasResolvedSpin = true;
      }
    } else {
      groups.set(key, {
        key,
        artist,
        title,
        spinIds: [row.id],
        durationHints:
          row.durationMs != null && row.durationMs > 0 ? [row.durationMs] : [],
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
      attempted: 0,
      resolved: 0,
      deferred: 0,
      unavailable: 0,
      definitiveMiss: 0,
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
    let attempted = 0;
    const deadline = Date.now() + BATCH_BUDGET_MS;

    for (const candidate of candidates) {
      if (Date.now() > deadline) break;
      attempted++;
      let mbid = candidate.cached?.mbid ?? null;
      if (!mbid || mbid.startsWith("sp:")) {
        try {
          const textResult = await resolveTextWithVariants(
            candidate.artist,
            candidate.title,
            candidate.durationHints,
            async (artist, title) => {
              const result = await resolver.resolveByTextWithScoreStatus(
                artist,
                title,
                AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
              );
              if (result.status !== "matched") return result;
              return {
                status: "matched",
                match: {
                  recordingId: result.mbid,
                  score: result.score,
                  title: result.title ?? title,
                  ...(result.artist ? { artist: result.artist } : {}),
                  ...(result.artistMbid ? { artistMbid: result.artistMbid } : {}),
                  ...(result.isrc ? { isrc: result.isrc } : {}),
                  ...(result.durationMs != null
                    ? { durationMs: result.durationMs }
                    : {}),
                },
              };
            },
          );
          if (textResult.status === "deferred") {
            await writeCache(candidate.key, null, "deferred");
            deferred++;
            continue;
          }
          mbid =
            textResult.status === "matched" && textResult.match.score >= 90
              ? textResult.match.recordingId
              : null;
          if (textResult.status === "matched") {
            candidate.canonical = textResult.match;
          }
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

      // A positive cache row already points at an existing canonical recording.
      // Attach waiting spins without rewriting that node from raw station text.
      if (!candidate.cached?.mbid) {
        await upsertRecording(
          {
            mbid,
            confidence: "text",
            artist: candidate.canonical?.artist ?? candidate.artist,
            title: candidate.canonical?.title || candidate.title,
            ...(candidate.canonical?.artistMbid
              ? { artistMbid: candidate.canonical.artistMbid }
              : {}),
            ...(candidate.canonical?.isrc
              ? { isrc: candidate.canonical.isrc }
              : {}),
            ...(candidate.canonical?.durationMs != null
              ? { durationMs: candidate.canonical.durationMs }
              : {}),
            fromCache: false,
          },
          undefined,
          false,
        );
      }
      await attachSpins(candidate, mbid);
      await writeCache(candidate.key, mbid, "text");
      resolved++;
    }

    const health = await getUnmatchedSpinHealth();
    return {
      candidates: candidates.length,
      scanned: candidates.length,
      attempted,
      resolved,
      deferred,
      unavailable,
      definitiveMiss: unavailable,
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