import {
  db,
  recordingsTable,
  spinsTable,
  showsTable,
  stationsTable,
  resolutionCacheTable,
  type Station,
} from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
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

  // Source handed us the canonical id — nothing to resolve or cache.
  if (opts?.recordingId) {
    return { mbid: opts.recordingId, confidence: "recording_id", ...base };
  }

  const key = normalizeKey(rawArtist, rawTitle);

  // Cache first — this is what keeps us under the MusicBrainz 1 req/sec budget.
  try {
    const cached = await readResolutionCache(key);
    if (cached) {
      const confidence = (cached.confidence as MbidResolution["confidence"]) ||
        "unresolved";
      return { mbid: cached.mbid, confidence, ...base };
    }
  } catch (err) {
    // A cache read failure must not block resolution — fall through to MB.
    console.error("[lore] resolution cache read failed", err);
  }

  const result = await resolveUncached(rawArtist, rawTitle, durationMs, opts);

  // Persist hit AND miss so we never re-query this pair.
  try {
    if (result.confidence !== "recording_id") {
      await writeResolutionCache(key, result.mbid, result.confidence);
    }
  } catch (err) {
    console.error("[lore] resolution cache write failed", err);
  }

  return result;
}

/** The actual (rate-limited) MusicBrainz resolution, behind the cache. */
async function resolveUncached(
  rawArtist: string,
  rawTitle: string,
  durationMs: number | undefined,
  opts: { isrc?: string } | undefined,
): Promise<MbidResolution> {
  const base = { title: rawTitle, artist: rawArtist };

  if (opts?.isrc) {
    const mbid = await resolveRecordingId(opts.isrc);
    if (mbid) return { mbid, confidence: "isrc", isrc: opts.isrc, ...base };
  }

  const match = await resolveRecordingByText(rawArtist, rawTitle);
  if (match && !durationMismatch(durationMs, match.durationMs)) {
    return {
      mbid: match.recordingId,
      confidence: "text",
      title: match.title || rawTitle,
      artist: match.artist || rawArtist,
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

/** Upsert the recording node for a resolved MBID, fetching links when missing. */
async function upsertRecording(
  r: MbidResolution,
  artworkUrl?: string,
): Promise<void> {
  const [existing] = await db
    .select({ mbid: recordingsTable.mbid, links: recordingsTable.links })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, r.mbid as string))
    .limit(1);

  let links = existing?.links ?? null;
  if (!links || links.length === 0) {
    const fetched = await resolveLinks(r.mbid as string, r.artist, r.title);
    links = fetched.length ? fetched : null;
  }

  await db
    .insert(recordingsTable)
    .values({
      mbid: r.mbid as string,
      title: r.title,
      artist: r.artist,
      artistMbid: r.artistMbid ?? null,
      isrc: r.isrc ?? null,
      durationMs: r.durationMs ?? null,
      artworkUrl: artworkUrl ?? null,
      links,
    })
    .onConflictDoUpdate({
      target: recordingsTable.mbid,
      set: {
        title: r.title,
        artist: r.artist,
        artistMbid: r.artistMbid ?? null,
        ...(r.isrc ? { isrc: r.isrc } : {}),
        ...(artworkUrl ? { artworkUrl } : {}),
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
}): Promise<boolean> {
  const { station, resolution: r, raw, showId, source, citation } = args;

  if (r.mbid) await upsertRecording(r, raw.artworkUrl);

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
 * Change-detection path for sources that only expose "the current track" with
 * no timestamp or stable id (Radio Paradise). Logs a spin iff the on-air track
 * changed since the last logged spin. Never throws.
 */
export async function logSpinIfChanged(
  station: Station,
  np: NowPlayingRaw,
): Promise<boolean> {
  try {
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

    const r = await resolveToMbid(np.rawArtist, np.rawTitle, np.durationMs, {
      ...(np.recordingId ? { recordingId: np.recordingId } : {}),
      ...(np.isrc ? { isrc: np.isrc } : {}),
    });

    return await persistSpin({
      station,
      resolution: r,
      raw: np,
      showId: null,
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
): Promise<number> {
  if (!spins.length) return 0;
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
      });
      if (wrote) logged++;
      if (cursorValue) newestCursor = cursorValue;
    }

    if (newestCursor && newestCursor !== station.lastSeenCursor) {
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
