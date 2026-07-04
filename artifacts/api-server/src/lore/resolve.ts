import {
  db,
  recordingsTable,
  spinsTable,
  showsTable,
  stationsTable,
  resolutionCacheTable,
  type Station,
} from "@workspace/db";
import { eq, and, desc, inArray, sql, gte } from "drizzle-orm";
import {
  resolveRecordingId,
  resolveRecordingByText,
  fetchRecordingLinks,
  type RecordingLink,
} from "@workspace/song-enrichment";
import { searchTrack } from "../spotify/appClient.js";
import type { NowPlayingRaw, RawSpin, ShowAttribution } from "./types.js";

/** Outcome of trying to place a now-playing track on the MusicBrainz spine. */
export interface MbidResolution {
  mbid: string | null;
  confidence: "recording_id" | "isrc" | "text" | "unresolved";
  title: string;
  artist: string;
  artistMbid?: string;
  isrc?: string;
  durationMs?: number;
}

// ---- Pure helpers (unit-tested; no DB / network) -----------------------

/**
 * Normalize an artist+title pair into a stable cache key. Lowercased, accents
 * and punctuation stripped, whitespace collapsed, joined with a Unit Separator
 * (U+001F) so "The Beatles" / "Hey Jude" can never collide with a
 * differently-split pair. A NUL (U+0000) can't be used — Postgres rejects it in
 * a `text` column — but the normalized halves only contain [a-z0-9 ], so any
 * non-alphanumeric separator is collision-safe. Deliberately independent of
 * duration so every edit/pressing of the same artist+title shares one entry.
 */
export function normalizeKey(artist: string, title: string): string {
  const norm = (s: string): string =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  return `${norm(artist)}\u001f${norm(title)}`;
}

/**
 * Whether a source-reported duration and a candidate recording's duration are
 * grossly incompatible. Deliberately lenient (2 min tolerance): only catches a
 * clip-vs-full-song or wrong-recording mismatch, never a normal edit/remaster
 * difference. Returns false whenever either duration is missing — absence is
 * never evidence of a mismatch.
 */
export function durationMismatch(
  hintMs?: number,
  candidateMs?: number,
  toleranceMs = 120_000,
): boolean {
  if (hintMs == null || candidateMs == null) return false;
  if (hintMs <= 0 || candidateMs <= 0) return false;
  return Math.abs(hintMs - candidateMs) > toleranceMs;
}

/** Signature used to detect whether the on-air track actually changed. */
function sig(artist: string, title: string): string {
  return normalizeKey(artist, title);
}

// ---- Resolution cache (hits AND misses) --------------------------------

/**
 * Look up a cached text/ISRC resolution. Returns `undefined` on a true miss
 * (never queried), or a row (possibly with `mbid=null`) when we've resolved —
 * or failed to resolve — this artist+title before. Caching misses is the whole
 * point: an unresolvable track must not re-hit MusicBrainz on every spin.
 */
async function readResolutionCache(
  key: string,
): Promise<{ mbid: string | null; confidence: string } | undefined> {
  const [row] = await db
    .select({
      mbid: resolutionCacheTable.mbid,
      confidence: resolutionCacheTable.confidence,
    })
    .from(resolutionCacheTable)
    .where(eq(resolutionCacheTable.key, key))
    .limit(1);
  return row ?? undefined;
}

async function writeResolutionCache(
  key: string,
  mbid: string | null,
  confidence: string,
): Promise<void> {
  await db
    .insert(resolutionCacheTable)
    .values({ key, mbid, confidence })
    .onConflictDoUpdate({
      target: resolutionCacheTable.key,
      set: { mbid, confidence, updatedAt: sql`now()` },
    });
}

/** Cache read that never throws — a read failure just falls through to MB. */
async function readResolutionCacheSafe(
  key: string,
): Promise<{ mbid: string | null; confidence: string } | undefined> {
  try {
    return await readResolutionCache(key);
  } catch (err) {
    console.error("[lore] resolution cache read failed", err);
    return undefined;
  }
}

/** Cache write that never throws — a write failure must not break resolution. */
async function writeResolutionCacheSafe(
  key: string,
  mbid: string | null,
  confidence: string,
): Promise<void> {
  try {
    await writeResolutionCache(key, mbid, confidence);
  } catch (err) {
    console.error("[lore] resolution cache write failed", err);
  }
}

/** Cache key for an ISRC lookup — namespaced away from text keys on purpose. */
function isrcKey(isrc: string): string {
  return `isrc\u001f${isrc.trim().toUpperCase()}`;
}

/**
 * Resolve a raw artist+title to a MusicBrainz Recording ID (the spine key).
 *
 * Preference order mirrors confidence: a source-supplied recording id (KEXP) >
 * an ISRC lookup > a scored artist+title search. A local DB cache sits in front
 * of the (rate-limited) MusicBrainz calls and stores BOTH hits and misses, so
 * the same track — resolvable or not — is only ever queried against
 * MusicBrainz once. Never throws.
 *
 * `durationMs` is a sanity gate on text matches: a grossly incompatible
 * duration downgrades an otherwise-accepted match to unresolved rather than
 * pinning a spin to the wrong recording.
 */
export async function resolveToMbid(
  rawArtist: string,
  rawTitle: string,
  durationMs?: number,
  opts?: { recordingId?: string; isrc?: string },
): Promise<MbidResolution> {
  const base = { title: rawTitle, artist: rawArtist };

  // 1. Source handed us the canonical id — strongest, free, nothing to cache.
  if (opts?.recordingId) {
    return { mbid: opts.recordingId, confidence: "recording_id", ...base };
  }

  // 2. ISRC — a strong identifier, tried BEFORE the text cache and under its
  //    own key namespace. This is what lets a spin that was only ever seen as
  //    text-unresolved converge later: a weaker text-keyed miss can never
  //    short-circuit an ISRC that a subsequent spin carries. Hits AND misses
  //    are cached under the ISRC key, so we still honor the 1 req/sec budget.
  if (opts?.isrc) {
    const ik = isrcKey(opts.isrc);
    const cached = await readResolutionCacheSafe(ik);
    if (cached === undefined) {
      let mbid: string | null = null;
      try {
        mbid = await resolveRecordingId(opts.isrc);
      } catch (err) {
        console.error("[lore] isrc resolution failed", opts.isrc, err);
      }
      await writeResolutionCacheSafe(ik, mbid, mbid ? "isrc" : "unresolved");
      if (mbid) return { mbid, confidence: "isrc", isrc: opts.isrc, ...base };
    } else if (cached.mbid) {
      return { mbid: cached.mbid, confidence: "isrc", isrc: opts.isrc, ...base };
    }
    // Cached miss OR live miss — fall through to a text search.
  }

  // 3. Scored artist+title search — keyed on the normalized pair. The cache
  //    (hit or miss) keeps us under the MusicBrainz 1 req/sec budget.
  const key = normalizeKey(rawArtist, rawTitle);
  const cached = await readResolutionCacheSafe(key);
  if (cached) {
    const confidence =
      (cached.confidence as MbidResolution["confidence"]) || "unresolved";
    return { mbid: cached.mbid, confidence, ...base };
  }

  const match = await resolveRecordingByText(rawArtist, rawTitle);
  if (match && !durationMismatch(durationMs, match.durationMs)) {
    const result: MbidResolution = {
      mbid: match.recordingId,
      confidence: "text",
      title: match.title || rawTitle,
      artist: match.artist || rawArtist,
      ...(match.artistMbid ? { artistMbid: match.artistMbid } : {}),
      ...(match.isrc ? { isrc: match.isrc } : {}),
      ...(match.durationMs != null ? { durationMs: match.durationMs } : {}),
    };
    await writeResolutionCacheSafe(key, result.mbid, "text");
    return result;
  }

  // Cache the miss so an unresolvable pair isn't re-queried on every spin.
  await writeResolutionCacheSafe(key, null, "unresolved");
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
): Promise<{ links: RecordingLink[]; spotifyArtworkUrl: string | null }> {
  let spotifyTrackId: string | undefined;
  let spotifyArtworkUrl: string | null = null;
  try {
    const hit = await searchTrack(`${artist} ${title}`);
    if (hit) {
      spotifyTrackId = hit.id;
      spotifyArtworkUrl = hit.imageUrl;
    }
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
  return { links: links?.platforms ?? [], spotifyArtworkUrl };
}

/**
 * Artwork-only Spotify lookup for recordings whose links already converged but
 * whose station feed never carried a cover (SomaFM et al). Skips Odesli
 * entirely, so it never spends the rate-limited budget. Known misses are
 * memoized (in-memory, TTL) so a coverless track that re-spins all day doesn't
 * re-issue the same failing search on every ingestion.
 */
const ARTWORK_MISS_TTL_MS = 24 * 60 * 60 * 1000;
const artworkMissUntil = new Map<string, number>();

async function lookupSpotifyArtwork(
  mbid: string,
  artist: string,
  title: string,
): Promise<string | null> {
  const missUntil = artworkMissUntil.get(mbid);
  if (missUntil && Date.now() < missUntil) return null;
  try {
    const hit = await searchTrack(`${artist} ${title}`);
    const url = hit?.imageUrl ?? null;
    if (!url) artworkMissUntil.set(mbid, Date.now() + ARTWORK_MISS_TTL_MS);
    else artworkMissUntil.delete(mbid);
    return url;
  } catch {
    // Transient failure (rate limit, network): don't memoize as a miss.
    return null;
  }
}

/**
 * Upsert the recording node for a resolved MBID, fetching links when missing.
 * `enrichLinks: false` (deep backfill) skips the per-recording Spotify/Odesli
 * fetch entirely — the spine node still lands, and links converge later when
 * the track is viewed or spun live.
 */
async function upsertRecording(
  r: MbidResolution,
  artworkUrl?: string,
  enrichLinks = true,
): Promise<void> {
  const [existing] = await db
    .select({
      mbid: recordingsTable.mbid,
      links: recordingsTable.links,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, r.mbid as string))
    .limit(1);

  let links = existing?.links ?? null;
  // Feed-provided art always wins; Spotify's album cover is the fallback for
  // stations (SomaFM et al) whose feed never carries one.
  let fallbackArtwork: string | null = null;
  const artworkMissing = !artworkUrl && !existing?.artworkUrl;
  if (enrichLinks && (!links || links.length === 0)) {
    const fetched = await resolveLinks(r.mbid as string, r.artist, r.title);
    links = fetched.links.length ? fetched.links : null;
    fallbackArtwork = fetched.spotifyArtworkUrl;
  } else if (enrichLinks && artworkMissing) {
    // Links already converged but the cover never did — artwork-only lookup.
    fallbackArtwork = await lookupSpotifyArtwork(
      r.mbid as string,
      r.artist,
      r.title,
    );
  }
  const newArtwork = artworkUrl ?? (artworkMissing ? fallbackArtwork : null);

  await db
    .insert(recordingsTable)
    .values({
      mbid: r.mbid as string,
      title: r.title,
      artist: r.artist,
      artistMbid: r.artistMbid ?? null,
      isrc: r.isrc ?? null,
      durationMs: r.durationMs ?? null,
      artworkUrl: newArtwork,
      links,
    })
    .onConflictDoUpdate({
      target: recordingsTable.mbid,
      set: {
        title: r.title,
        artist: r.artist,
        artistMbid: r.artistMbid ?? null,
        ...(r.isrc ? { isrc: r.isrc } : {}),
        ...(newArtwork ? { artworkUrl: newArtwork } : {}),
        ...(links ? { links } : {}),
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Resolve (or reuse) a show row for a station's program, returning its id.
 * Idempotent by (station, name, dj): a station's recurring show maps to one
 * row across restarts. Best-effort — returns null on any failure so a spin is
 * still logged without attribution rather than dropped.
 */
async function upsertShow(
  stationId: number,
  show: ShowAttribution,
): Promise<number | null> {
  const name = show.name.trim();
  if (!name) return null;
  const djName = show.djName?.trim() || null;
  try {
    const [existing] = await db
      .select({ id: showsTable.id, djName: showsTable.djName })
      .from(showsTable)
      .where(and(eq(showsTable.stationId, stationId), eq(showsTable.name, name)))
      .limit(1);
    if (existing) {
      if (djName && existing.djName !== djName) {
        await db
          .update(showsTable)
          .set({ djName })
          .where(eq(showsTable.id, existing.id));
      }
      return existing.id;
    }
    const [inserted] = await db
      .insert(showsTable)
      .values({ stationId, name, djName })
      .returning({ id: showsTable.id });
    return inserted?.id ?? null;
  } catch (err) {
    console.error("[lore] upsertShow failed", stationId, name, err);
    return null;
  }
}

/**
 * Persist one resolved spin: upsert its recording node (when resolved), then
 * insert the spin row. The unique (station, externalId) index makes this
 * idempotent for sources that carry a stable id. Returns true when a NEW spin
 * row was written.
 */
async function persistSpin(args: {
  station: Station;
  resolution: MbidResolution;
  raw: RawSpin;
  showId: number | null;
  source: string;
  citation?: string;
  enrichLinks?: boolean;
}): Promise<boolean> {
  const { station, resolution: r, raw, showId, source, citation } = args;

  if (r.mbid) await upsertRecording(r, raw.artworkUrl, args.enrichLinks ?? true);

  const inserted = await db
    .insert(spinsTable)
    .values({
      stationId: station.id,
      showId: showId ?? null,
      mbid: r.mbid,
      rawArtist: raw.rawArtist,
      rawTitle: raw.rawTitle,
      source,
      externalId: raw.externalId ?? null,
      citation: citation ?? null,
      confidence: r.confidence,
      ...(raw.playedAt ? { playedAt: raw.playedAt } : {}),
    })
    .onConflictDoNothing({
      target: [spinsTable.stationId, spinsTable.externalId],
    })
    .returning({ id: spinsTable.id });

  return inserted.length > 0;
}

// ---- Ingestion paths ----------------------------------------------------

/**
 * How long (ms) a spin with the same signature must be absent before we treat
 * it as a new play. This guards against brief API stale-data windows during
 * show handoffs (e.g. NTS briefly serving the previous show): even if the most
 * recent logged spin is a different show, we skip writing when the same sig
 * was already logged within this window to avoid a false A→B→A→B bounce.
 */
const DEDUP_WINDOW_MS = 30_000;

/**
 * Change-detection path for sources that only expose "the current track" with
 * no timestamp or stable id (Radio Paradise, NTS). Logs a spin iff the on-air
 * track changed since the last logged spin AND the same sig has not been
 * written within the last DEDUP_WINDOW_MS. Never throws.
 *
 * The recency window catches a specific stale-data pattern: the API momentarily
 * returns a previous show during handoff, causing an A→stale-B→A bounce. The
 * second A arrives with a different "last spin" (stale B) so the ordinary sig
 * check would pass — the window prevents writing a duplicate A.
 */
export async function logSpinIfChanged(
  station: Station,
  np: NowPlayingRaw,
): Promise<boolean> {
  try {
    const candidateSig = sig(np.rawArtist, np.rawTitle);

    const [last] = await db
      .select({
        rawArtist: spinsTable.rawArtist,
        rawTitle: spinsTable.rawTitle,
        playedAt: spinsTable.playedAt,
      })
      .from(spinsTable)
      .where(eq(spinsTable.stationId, station.id))
      .orderBy(desc(spinsTable.playedAt))
      .limit(1);

    // Primary dedup: same track as the current last spin → nothing changed.
    if (
      last &&
      last.rawArtist &&
      last.rawTitle &&
      sig(last.rawArtist, last.rawTitle) === candidateSig
    ) {
      return false;
    }

    // Recency dedup: the same sig was already written within DEDUP_WINDOW_MS,
    // even if a different spin landed in between (stale-data bounce guard).
    const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);
    const recentMatch = await db
      .select({ id: spinsTable.id })
      .from(spinsTable)
      .where(
        and(
          eq(spinsTable.stationId, station.id),
          eq(spinsTable.rawArtist, np.rawArtist),
          eq(spinsTable.rawTitle, np.rawTitle),
          gte(spinsTable.playedAt, windowStart),
        ),
      )
      .limit(1);
    if (recentMatch.length > 0) {
      return false;
    }

    const r = await resolveToMbid(np.rawArtist, np.rawTitle, np.durationMs, {
      ...(np.recordingId ? { recordingId: np.recordingId } : {}),
      ...(np.isrc ? { isrc: np.isrc } : {}),
    });

    const showId = np.show ? await upsertShow(station.id, np.show) : null;

    return await persistSpin({
      station,
      resolution: r,
      raw: np,
      showId,
      source: station.nowPlayingSource ?? "unknown",
    });
  } catch (err) {
    console.error("[lore] logSpinIfChanged failed", station.slug, err);
    return false;
  }
}

/**
 * Batch ingest a station's recent plays from a history feed (KEXP, Spinitron,
 * BBC, station_page). Idempotent and cursor-driven:
 *   1. Drop plays already logged (unique station+externalId), so we never
 *      re-resolve — the key lever for the MusicBrainz budget during backfill.
 *   2. Resolve + upsert recording + upsert show for genuinely-new plays only,
 *      oldest-first so history reads chronologically.
 *   3. Advance the per-station cursor to the newest externalId (or playedAt).
 * Returns the number of new spins logged. Never throws.
 */
export async function ingestRawSpins(
  station: Station,
  spins: RawSpin[],
  source: string,
  opts?: {
    /**
     * Deep-backfill mode: don't advance `lastSeenCursor` (that cursor belongs
     * to LIVE polling and only ever moves forward) and skip per-recording link
     * enrichment (Spotify/Odesli) so a big historical slice never fans out
     * into hundreds of link fetches. Links converge later.
     */
    backfill?: boolean;
    /**
     * Reconciliation mode: like backfill, never touch `lastSeenCursor` (the
     * live poller owns it, and a gap-fill sweep must not yank it around) — but
     * KEEP link enrichment, because the window is small and bounded and these
     * spins should end up indistinguishable from live-polled ones.
     */
    reconcile?: boolean;
  },
): Promise<number> {
  if (!spins.length) return 0;
  const backfill = opts?.backfill ?? false;
  const skipCursor = backfill || (opts?.reconcile ?? false);
  try {
    // Oldest-first so segue derivation and now-playing ordering read naturally.
    const ordered = [...spins].sort((a, b) => {
      const ta = a.playedAt?.getTime() ?? 0;
      const tb = b.playedAt?.getTime() ?? 0;
      return ta - tb;
    });

    // Pre-filter already-ingested externalIds in one query — skip re-resolving.
    const externalIds = ordered
      .map((s) => s.externalId)
      .filter((v): v is string => !!v);
    let seen = new Set<string>();
    if (externalIds.length) {
      const rows = await db
        .select({ externalId: spinsTable.externalId })
        .from(spinsTable)
        .where(
          and(
            eq(spinsTable.stationId, station.id),
            inArray(spinsTable.externalId, externalIds),
          ),
        );
      seen = new Set(rows.map((r) => r.externalId).filter((v): v is string => !!v));
    }

    let logged = 0;
    let newestCursor: string | null = station.lastSeenCursor ?? null;
    for (const raw of ordered) {
      const cursorValue =
        raw.externalId ?? raw.playedAt?.toISOString() ?? null;
      if (raw.externalId && seen.has(raw.externalId)) {
        if (cursorValue) newestCursor = cursorValue;
        continue;
      }

      const r = await resolveToMbid(raw.rawArtist, raw.rawTitle, raw.durationMs, {
        ...(raw.recordingId ? { recordingId: raw.recordingId } : {}),
        ...(raw.isrc ? { isrc: raw.isrc } : {}),
      });
      const showId = raw.show ? await upsertShow(station.id, raw.show) : null;
      const wrote = await persistSpin({
        station,
        resolution: r,
        raw,
        showId,
        source,
        enrichLinks: !backfill,
      });
      if (wrote) logged++;
      if (cursorValue) newestCursor = cursorValue;
    }

    if (!skipCursor && newestCursor && newestCursor !== station.lastSeenCursor) {
      await db
        .update(stationsTable)
        .set({ lastSeenCursor: newestCursor })
        .where(eq(stationsTable.id, station.id));
    }

    return logged;
  } catch (err) {
    console.error("[lore] ingestRawSpins failed", station.slug, err);
    return 0;
  }
}

/**
 * Admin-only manual/historical spin entry. Resolves the track to the spine and
 * logs it with source="manual" and a citation to the survey/archive it came
 * from. Returns the logged flag + resolution. Throws on bad input so the route
 * can surface a 400.
 */
export async function ingestManualSpin(args: {
  station: Station;
  artist: string;
  title: string;
  playedAt: Date;
  citation: string;
  show?: ShowAttribution;
  durationMs?: number;
}): Promise<{ logged: boolean; resolution: MbidResolution }> {
  const artist = args.artist.trim();
  const title = args.title.trim();
  const citation = args.citation.trim();
  if (!artist || !title) throw new Error("artist and title are required");
  if (!citation) throw new Error("citation is required for manual entries");

  const resolution = await resolveToMbid(artist, title, args.durationMs);
  const showId = args.show ? await upsertShow(args.station.id, args.show) : null;
  const logged = await persistSpin({
    station: args.station,
    resolution,
    raw: {
      rawArtist: artist,
      rawTitle: title,
      playedAt: args.playedAt,
      ...(args.show ? { show: args.show } : {}),
    },
    showId,
    source: "manual",
    citation,
  });
  return { logged, resolution };
}
