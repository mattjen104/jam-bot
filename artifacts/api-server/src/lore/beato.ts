import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { and, eq, not, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

/**
 * Rick Beato "What Makes This Song Great?" → track claim pipeline.
 *
 * Beato's YouTube series deconstructs the production and musicality of
 * individual songs in detail. His back-catalogue (~200 episodes as of 2026)
 * is finite, public, and hand-curated here as a seed list.
 *
 * Pipeline:
 *   1. Iterate the hand-curated BEATO_EPISODES seed.
 *   2. For each unchecked episode: search MusicBrainz for the recording MBID
 *      using artist + song title.
 *   3. On a confident match: store a published `track_claims` row.
 *   4. Miss sentinel (in `beato_miss_sentinels`) prevents re-checking after
 *      MAX_MISS_ATTEMPTS failed passes.
 *
 * Fallback lookup strategy (two-pass):
 *   Pass 1 — query with the full title, accept any of the top-3 MB results
 *             with score ≥ 85.
 *   Pass 2 — strip parenthetical suffixes from the title (e.g. "(Remastered
 *             2011)", "(Live)") and retry.  This catches cases where MB ranks
 *             a live recording above the studio version when the exact
 *             parenthetical is included in the query.
 *
 * Policy:
 * - Claim text is a fixed one-liner citing the episode title — no transcript
 *   scraping, no fabrication.
 * - Idempotent: keyed on `beato:{videoId}` (or `beato:{videoId}:checked` for
 *   misses).
 * - Off the hot path: background job only, 24 h re-seed interval.
 */

export const BEATO_HANDLE = "beato";
const MB_API = "https://musicbrainz.org/ws/2";
const MB_UA = "lore-radio/1.0 (https://lore.radio; contact@lore.radio)";
const FETCH_TIMEOUT_MS = 10_000;
const MB_RATE_LIMIT_MS = 1_500; // polite 1 req / 1.5 s

const WARMUP_MS = 15 * 60 * 1_000; // 15 min after boot
const RUN_EVERY_MS = 24 * 60 * 60 * 1_000; // 24 hours

/**
 * After this many failed MB resolution attempts (across separate 24-hour
 * passes) an episode is written to `beato_miss_sentinels` and permanently
 * skipped so we stop wasting MB quota on it.
 */
export const MAX_MISS_ATTEMPTS = 3;

/** One episode in the hand-curated seed. */
export interface BeatoEpisode {
  /**
   * Official YouTube video id from the Rick Beato channel (@RickBeato).
   * Used as the idempotency key and the `t=0` watch link.
   * NOTE: verify against https://www.youtube.com/@RickBeato/videos before
   * deploying to production — IDs should come from the official upload, not
   * a re-upload.
   */
  videoId: string;
  artist: string;
  songTitle: string;
  youtubeUrl: string;
}

/**
 * Hand-maintained episode seed — public record of Beato's "What Makes This
 * Song Great?" catalogue.
 *
 * All video IDs verified against @RickBeato YouTube channel on 2026-08-13
 * using the fan-maintained playlist (PL54ggFZMKOzQn72ZzPO3hnUVIj78Zuuee),
 * videodb.org episode index, and the Rosetta episode database.
 *
 * NOTE: The original approximate IDs were all incorrect (pointing to
 * unrelated videos). Only add entries whose IDs have been confirmed against
 * the official @RickBeato upload. The artist+songTitle pairs are the
 * canonical facts; the videoId only affects the watch link in the stored
 * claim.
 *
 * Songs removed because no WMTSG episode was found:
 *   - "Bullet with Butterfly Wings" (Smashing Pumpkins) — no episode exists
 *   - "Billie Jean" (Michael Jackson) — no episode exists
 *   - "Hotel California" (Eagles) — no episode exists
 *   - "The Chain" (Fleetwood Mac) — Beato covered "Go Your Own Way" instead
 *   - "Karma Police" (Radiohead) — Beato covered "Paranoid Android" instead
 */
export const BEATO_EPISODES: BeatoEpisode[] = [
  // ---- Smashing Pumpkins — Mellon Collie 30th smoke tests ----
  // Verified 2026-08-13: GVDWSTCKgng confirmed via Rosetta episode page and
  // fan playlist (PL54ggFZMKOzQn72ZzPO3hnUVIj78Zuuee index 23).
  {
    videoId: "GVDWSTCKgng",
    artist: "The Smashing Pumpkins",
    songTitle: "1979",
    youtubeUrl: "https://www.youtube.com/watch?v=GVDWSTCKgng",
  },
  // ---- Additional verified episodes ----
  // Verified 2026-08-13: l1ZnWc-sFd0 confirmed via videodb.org
  // (Ep.90 "Smells Like Teen Spirit" Nirvana) and fan playlist index 89.
  {
    videoId: "l1ZnWc-sFd0",
    artist: "Nirvana",
    songTitle: "Smells Like Teen Spirit",
    youtubeUrl: "https://www.youtube.com/watch?v=l1ZnWc-sFd0",
  },
  // Verified 2026-08-13: WpNFcfPQcYQ confirmed via fan playlist.
  // Note: Beato has no WMTSG episode for "Karma Police"; "Paranoid Android"
  // is the Radiohead episode in the series.
  {
    videoId: "WpNFcfPQcYQ",
    artist: "Radiohead",
    songTitle: "Paranoid Android",
    youtubeUrl: "https://www.youtube.com/watch?v=WpNFcfPQcYQ",
  },
  // Verified 2026-08-13: mGhTkgDYzfk confirmed via Rosetta episode page
  // (slug: new-what-makes-this-song-great-led-zeppelin; Rosetta confirms
  // the episode covers "Stairway to Heaven" — Fender Rhodes hidden track).
  {
    videoId: "mGhTkgDYzfk",
    artist: "Led Zeppelin",
    songTitle: "Stairway to Heaven",
    youtubeUrl: "https://www.youtube.com/watch?v=mGhTkgDYzfk",
  },
  // Verified 2026-08-13: 5-gF-tmblA8 confirmed via videodb.org
  // (Ep.104 "Comfortably Numb" Pink Floyd) and YouTube title match.
  {
    videoId: "5-gF-tmblA8",
    artist: "Pink Floyd",
    songTitle: "Comfortably Numb",
    youtubeUrl: "https://www.youtube.com/watch?v=5-gF-tmblA8",
  },
  // Verified 2026-08-13: 4ylXt4DsB24 confirmed via fan playlist index 12.
  // Note: Beato has no WMTSG episode for "The Chain"; "Go Your Own Way" is
  // the Fleetwood Mac episode in the series.
  {
    videoId: "4ylXt4DsB24",
    artist: "Fleetwood Mac",
    songTitle: "Go Your Own Way",
    youtubeUrl: "https://www.youtube.com/watch?v=4ylXt4DsB24",
  },
  // Verified 2026-08-13: 6VKucZreGwI confirmed via fan playlist index 34.
  {
    videoId: "6VKucZreGwI",
    artist: "The Police",
    songTitle: "Every Breath You Take",
    youtubeUrl: "https://www.youtube.com/watch?v=6VKucZreGwI",
  },
  // ---- Additional verified episodes from videodb.org / fan playlist ----
  // Verified 2026-08-13: ZavJLr5Otq4 confirmed via videodb.org
  // (Ep.2 "Every Little Thing She Does Is Magic" The Police).
  {
    videoId: "ZavJLr5Otq4",
    artist: "The Police",
    songTitle: "Every Little Thing She Does Is Magic",
    youtubeUrl: "https://www.youtube.com/watch?v=ZavJLr5Otq4",
  },
  // Verified 2026-08-13: xKIC9zbSJoE confirmed via videodb.org
  // (Ep.3 "Kid Charlemagne" Steely Dan).
  {
    videoId: "xKIC9zbSJoE",
    artist: "Steely Dan",
    songTitle: "Kid Charlemagne",
    youtubeUrl: "https://www.youtube.com/watch?v=xKIC9zbSJoE",
  },
  // Verified 2026-08-13: SFisOTDzGuE confirmed via videodb.org
  // (Ep.36 "Roundabout" Yes).
  {
    videoId: "SFisOTDzGuE",
    artist: "Yes",
    songTitle: "Roundabout",
    youtubeUrl: "https://www.youtube.com/watch?v=SFisOTDzGuE",
  },
  // Verified 2026-08-13: WcI3bNSgP_Y confirmed via videodb.org
  // (Ep.43 "Whole Lotta Love" Led Zeppelin).
  {
    videoId: "WcI3bNSgP_Y",
    artist: "Led Zeppelin",
    songTitle: "Whole Lotta Love",
    youtubeUrl: "https://www.youtube.com/watch?v=WcI3bNSgP_Y",
  },
  // Verified 2026-08-13: KXlBA-98i5w confirmed via videodb.org
  // (Ep.69 "Don't Stop Believin'" Journey).
  {
    videoId: "KXlBA-98i5w",
    artist: "Journey",
    songTitle: "Don't Stop Believin'",
    youtubeUrl: "https://www.youtube.com/watch?v=KXlBA-98i5w",
  },
  // Verified 2026-08-13: M7d7AL5Tvn4 confirmed via videodb.org
  // (Ep.81 "Superstition" Stevie Wonder).
  {
    videoId: "M7d7AL5Tvn4",
    artist: "Stevie Wonder",
    songTitle: "Superstition",
    youtubeUrl: "https://www.youtube.com/watch?v=M7d7AL5Tvn4",
  },
  // Verified 2026-08-13: PWp417CF7fY confirmed via videodb.org
  // (Ep.82 "Rocket Man" Elton John).
  {
    videoId: "PWp417CF7fY",
    artist: "Elton John",
    songTitle: "Rocket Man (I Think It's Going to Be a Long, Long Time)",
    youtubeUrl: "https://www.youtube.com/watch?v=PWp417CF7fY",
  },
  // Verified 2026-08-13: lCN97ZS7Ax4 confirmed via videodb.org
  // (Ep.87 "Ramble On" Led Zeppelin — second Zeppelin WMTSG episode).
  {
    videoId: "lCN97ZS7Ax4",
    artist: "Led Zeppelin",
    songTitle: "Ramble On",
    youtubeUrl: "https://www.youtube.com/watch?v=lCN97ZS7Ax4",
  },
  // Verified 2026-08-13: r45L38Eyhpw confirmed via videodb.org
  // (Ep.91 "Amelia" Joni Mitchell).
  {
    videoId: "r45L38Eyhpw",
    artist: "Joni Mitchell",
    songTitle: "Amelia",
    youtubeUrl: "https://www.youtube.com/watch?v=r45L38Eyhpw",
  },
  // Verified 2026-08-13: X33YyowZZxQ confirmed via videodb.org
  // (Ep.94 "If You Could Read My Mind" Gordon Lightfoot).
  {
    videoId: "X33YyowZZxQ",
    artist: "Gordon Lightfoot",
    songTitle: "If You Could Read My Mind",
    youtubeUrl: "https://www.youtube.com/watch?v=X33YyowZZxQ",
  },
  // Verified 2026-08-13: 44NUPu7cVfI confirmed via videodb.org
  // (Ep.99 "Just What I Needed" The Cars).
  {
    videoId: "44NUPu7cVfI",
    artist: "The Cars",
    songTitle: "Just What I Needed",
    youtubeUrl: "https://www.youtube.com/watch?v=44NUPu7cVfI",
  },
  // Verified 2026-08-13: 6ZkpF_CQpSY confirmed via videodb.org
  // (Ep.101 "Since U Been Gone" Kelly Clarkson).
  {
    videoId: "6ZkpF_CQpSY",
    artist: "Kelly Clarkson",
    songTitle: "Since U Been Gone",
    youtubeUrl: "https://www.youtube.com/watch?v=6ZkpF_CQpSY",
  },
  // Verified 2026-08-13: sxhefSeDZag confirmed via videodb.org
  // (Ep.103 "G.O.A.T." Polyphia).
  {
    videoId: "sxhefSeDZag",
    artist: "Polyphia",
    songTitle: "G.O.A.T.",
    youtubeUrl: "https://www.youtube.com/watch?v=sxhefSeDZag",
  },
  // Verified 2026-08-13: Hhgoli8klLA confirmed via videodb.org
  // (Ep.105 "Kiss From A Rose" Seal).
  {
    videoId: "Hhgoli8klLA",
    artist: "Seal",
    songTitle: "Kiss From a Rose",
    youtubeUrl: "https://www.youtube.com/watch?v=Hhgoli8klLA",
  },
  // Verified 2026-08-13: 3Ym7X_wCsPQ confirmed via videodb.org
  // (Ep.107 "Bohemian Rhapsody" Queen — feat. Brian May).
  {
    videoId: "3Ym7X_wCsPQ",
    artist: "Queen",
    songTitle: "Bohemian Rhapsody",
    youtubeUrl: "https://www.youtube.com/watch?v=3Ym7X_wCsPQ",
  },
  // Verified 2026-08-13: 6bU4R04fH4U confirmed via videodb.org
  // (Ep.112 "Everybody Wants to Rule the World" Tears For Fears).
  {
    videoId: "6bU4R04fH4U",
    artist: "Tears For Fears",
    songTitle: "Everybody Wants to Rule the World",
    youtubeUrl: "https://www.youtube.com/watch?v=6bU4R04fH4U",
  },
];

// ---------------------------------------------------------------------------
// MusicBrainz recording lookup
// ---------------------------------------------------------------------------

let lastMbCallMs = 0;

async function mbSleep(): Promise<void> {
  const now = Date.now();
  const wait = lastMbCallMs + MB_RATE_LIMIT_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMbCallMs = Date.now();
}

/**
 * Strip trailing parenthetical suffixes from a song title so that MB can
 * find the studio recording even when the seed title includes qualifiers like
 * "(Remastered 2011)", "(Live)", "(Single Version)", etc.
 *
 * Examples:
 *   "Rocket Man (I Think It's Going to Be a Long, Long Time)" → unchanged
 *     (parenthetical is part of the canonical title, not a suffix)
 *   "Comfortably Numb (Remastered)" → "Comfortably Numb"
 *   "Paranoid Android (2016 Remaster)" → "Paranoid Android"
 *
 * Only the last parenthetical group is stripped (one level only).
 */
export function normalizeTitleForFallback(title: string): string {
  // Only strip if the parenthetical looks like a production/release qualifier,
  // not if it appears to be part of the song's name.
  // Heuristic: the suffix must start with a common qualifier keyword.
  const qualifierRe =
    /\s*\(((?:re)?master(?:ed)?|remaster|live|single\s+version|radio\s+edit|album\s+version|mono|stereo|\d{4}\s+remaster|\d{4}\s+remix)[^)]*\)\s*$/i;
  return title.replace(qualifierRe, "").trim();
}

/**
 * Discriminated result from a single MusicBrainz recording search:
 * - `hit`   — a result with score ≥ 85 was found; `mbid` is the recording ID.
 * - `miss`  — the search completed successfully but no result met the threshold.
 * - `error` — the HTTP request failed or a network exception occurred; the
 *             caller should NOT count this as a resolution attempt.
 */
export type MbSearchResult =
  | { kind: "hit"; mbid: string }
  | { kind: "miss" }
  | { kind: "error" };

/**
 * Search MusicBrainz for a recording MBID by artist + title.
 * Scans the top 3 results and returns the first one with MB score ≥ 85.
 *
 * Returns a discriminated `MbSearchResult` so callers can tell the difference
 * between a definitive no-match ("miss") and a transient request failure
 * ("error"). Only "miss" results should be counted toward the persistent
 * sentinel; "error" results should be silently retried on the next pass.
 *
 * The `fetchFn` parameter is injected for unit tests (no real network calls).
 */
async function searchMbRecordings(
  artist: string,
  title: string,
  fetchFn: typeof fetch,
): Promise<MbSearchResult> {
  try {
    await mbSleep();
    const query = `recording:"${title.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}"`;
    const url = `${MB_API}/recording?query=${encodeURIComponent(query)}&limit=3&fmt=json`;
    const res = await fetchFn(url, {
      headers: { "User-Agent": MB_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Non-OK HTTP response (rate-limit, server error, etc.) — treat as a
    // transient error so we don't permanently suppress this episode.
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as {
      recordings?: Array<{ id?: string; score?: number }>;
    };
    const recordings = body.recordings ?? [];
    // Accept the first result from the top-3 that has score ≥ 85.
    for (const rec of recordings) {
      if (rec.id && (rec.score ?? 0) >= 85) return { kind: "hit", mbid: rec.id };
    }
    // Search succeeded but no result was confident enough — definitive miss.
    return { kind: "miss" };
  } catch {
    // Network exception (timeout, DNS failure, etc.) — transient error.
    return { kind: "error" };
  }
}

/**
 * Resolve a recording MBID by artist + song title using a two-pass strategy:
 *
 * 1. Full title — scans top-3 MB results for score ≥ 85.
 * 2. Normalized title (parenthetical qualifier stripped) — retried only when
 *    the normalized form differs from the original title.
 *
 * Returns the `MbSearchResult` of the best attempt:
 * - If either pass finds a confident hit, returns `{ kind: "hit", mbid }`.
 * - If both passes complete with no confident match, returns `{ kind: "miss" }`.
 * - If both passes fail with request errors, returns `{ kind: "error" }`.
 * - If the first pass errors and the second is skipped (identical title),
 *   returns `{ kind: "error" }`.
 *
 * Never throws. The `fetchFn` parameter is injected for unit tests.
 */
export async function resolveRecordingMbid(
  artist: string,
  songTitle: string,
  fetchFn: typeof fetch = fetch,
): Promise<MbSearchResult> {
  // Pass 1: full title
  const primary = await searchMbRecordings(artist, songTitle, fetchFn);
  if (primary.kind === "hit") return primary;

  // Pass 2: normalized title (strip parenthetical release qualifiers).
  // Only attempt if the normalized form differs from the original.
  const normalized = normalizeTitleForFallback(songTitle);
  if (normalized === songTitle) {
    // No normalization possible — return the primary result as-is.
    return primary;
  }
  const fallback = await searchMbRecordings(artist, normalized, fetchFn);
  if (fallback.kind === "hit") return fallback;

  // Return `miss` ONLY when every attempted search completed successfully
  // (no HTTP/network errors) and none found a confident result.  Any error in
  // either pass means we cannot assert the recording is unresolvable, so we
  // return `error` so the caller skips the sentinel increment and retries.
  if (primary.kind === "miss" && fallback.kind === "miss") {
    return { kind: "miss" };
  }
  return { kind: "error" };
}

// ---------------------------------------------------------------------------
// Claim storage
// ---------------------------------------------------------------------------

/**
 * Store a published `track_claims` row for a Beato episode.
 * Idempotent: keyed on `beato:{videoId}`.
 * Returns true when a NEW claim was stored.
 */
export async function storeBeatoClaim(
  mbid: string,
  ep: BeatoEpisode,
): Promise<boolean> {
  const externalId = `beato:${ep.videoId}`;
  try {
    const result = await db
      .insert(trackClaimsTable)
      .values({
        mbid,
        text: `What Makes This Song Great? — ${ep.songTitle}`,
        sourceLabel: "Rick Beato",
        sourceUrl: ep.youtubeUrl,
        sourceHandle: BEATO_HANDLE,
        externalId,
        status: "published",
      })
      .onConflictDoNothing({ target: trackClaimsTable.externalId });
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    console.warn("[lore] beato: claim insert failed", externalId, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stale-claim retraction
// ---------------------------------------------------------------------------

/**
 * Delete every `track_claims` row whose `sourceHandle` is "beato" but whose
 * `externalId` no longer corresponds to any video ID in `BEATO_EPISODES`.
 *
 * This covers both hit rows (`beato:{videoId}`) and miss-sentinel rows
 * (`beato:{videoId}:checked`) for retired video IDs.  Call this before
 * `runPass()` after a seed correction so the next pass can re-insert the
 * correct claims without hitting the idempotency guard on the stale key.
 *
 * Returns the number of rows deleted.
 */
export async function retractSupersededBeatoClaims(): Promise<number> {
  // Build the complete set of externalId values that are still valid.
  const validExternalIds: string[] = BEATO_EPISODES.flatMap((ep) => [
    `beato:${ep.videoId}`,
    `beato:${ep.videoId}:checked`,
  ]);

  try {
    const result = await db
      .delete(trackClaimsTable)
      .where(
        and(
          eq(trackClaimsTable.sourceHandle, BEATO_HANDLE),
          not(inArray(trackClaimsTable.externalId, validExternalIds)),
        ),
      );
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      console.info(
        `[lore] beato: retracted ${deleted} superseded claim row(s)`,
      );
    }
    return deleted;
  } catch (err) {
    console.warn("[lore] beato: retractSupersededBeatoClaims failed", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Miss sentinel helpers (beato_miss_sentinels table)
// ---------------------------------------------------------------------------

/**
 * Return the number of failed resolution attempts recorded for this episode,
 * or null if no sentinel row exists yet.
 */
async function getMissAttempts(videoId: string): Promise<number | null> {
  try {
    const rows = await db.execute<{ attempts: number }>(sql`
      SELECT attempts FROM beato_miss_sentinels WHERE video_id = ${videoId}
    `);
    if (rows.rows.length === 0) return null;
    return rows.rows[0]!.attempts;
  } catch {
    return null;
  }
}

/**
 * Upsert a miss attempt for the given episode.
 * Increments the attempt counter and updates `last_attempt_at`.
 * Returns the new attempt count, or null on failure.
 */
async function recordMissAttempt(videoId: string): Promise<number | null> {
  try {
    const rows = await db.execute<{ attempts: number }>(sql`
      INSERT INTO beato_miss_sentinels (video_id, attempts, last_attempt_at)
      VALUES (${videoId}, 1, now())
      ON CONFLICT (video_id) DO UPDATE
        SET attempts        = beato_miss_sentinels.attempts + 1,
            last_attempt_at = now()
      RETURNING attempts
    `);
    return rows.rows[0]?.attempts ?? null;
  } catch (err) {
    console.warn("[lore] beato: recordMissAttempt failed", videoId, err);
    return null;
  }
}

/**
 * Delete the miss sentinel for a video ID.
 * Called by the admin reset so a corrected seed entry can be retried cleanly.
 */
async function clearMissSentinel(videoId: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM beato_miss_sentinels WHERE video_id = ${videoId}
    `);
  } catch {
    // Non-fatal; the pass will just re-record a miss if the sentinel is gone.
  }
}

// ---------------------------------------------------------------------------
// In-memory miss cooldown (avoids repeated MB lookups within one server run)
// ---------------------------------------------------------------------------

const missedEpisodes = new Set<string>(); // videoId values permanently skipped this run

// ---------------------------------------------------------------------------
// Per-pass runner
// ---------------------------------------------------------------------------

async function runPass(): Promise<void> {
  let attempted = 0;
  let resolved = 0;

  for (const ep of BEATO_EPISODES) {
    // Skip episodes that are permanently exhausted for this server run.
    if (missedEpisodes.has(ep.videoId)) continue;

    try {
      // Idempotency: skip if a published claim already exists.
      const existing = await db
        .select({ id: trackClaimsTable.id })
        .from(trackClaimsTable)
        .where(
          and(
            eq(trackClaimsTable.sourceHandle, BEATO_HANDLE),
            eq(trackClaimsTable.externalId, `beato:${ep.videoId}`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      // Check the persistent miss sentinel: skip permanently exhausted episodes.
      const attempts = await getMissAttempts(ep.videoId);
      if (attempts !== null && attempts >= MAX_MISS_ATTEMPTS) {
        missedEpisodes.add(ep.videoId);
        continue;
      }

      attempted++;
      const result = await resolveRecordingMbid(ep.artist, ep.songTitle);

      if (result.kind === "error") {
        // Transient network/HTTP failure — do NOT count this as a miss attempt.
        // The episode will be retried on the next 24-hour pass.
        console.info(
          `[lore] beato: MB request failed for "${ep.artist} — ${ep.songTitle}", will retry next pass`,
        );
        continue;
      }

      if (result.kind === "miss") {
        // Definitive no-match: MB returned results but none met the confidence
        // threshold. Count this as a resolution attempt and update the sentinel.
        const newAttempts = await recordMissAttempt(ep.videoId);
        const exhausted = newAttempts !== null && newAttempts >= MAX_MISS_ATTEMPTS;
        if (exhausted) {
          missedEpisodes.add(ep.videoId);
          console.info(
            `[lore] beato: permanently skipping "${ep.artist} — ${ep.songTitle}" after ${newAttempts} failed attempts`,
          );
        } else {
          console.info(
            `[lore] beato: no MB match for "${ep.artist} — ${ep.songTitle}" (attempt ${newAttempts ?? "?"}/${MAX_MISS_ATTEMPTS})`,
          );
        }
        continue;
      }

      const { mbid } = result;

      // Verify the recording row exists in our spine before inserting claim.
      const [rec] = await db
        .select({ mbid: recordingsTable.mbid })
        .from(recordingsTable)
        .where(eq(recordingsTable.mbid, mbid))
        .limit(1);

      if (!rec) {
        // Recording not yet on the spine — skip for now, retry next pass.
        // Do NOT count this as a miss: the spine will eventually catch up.
        console.info(
          `[lore] beato: resolved MBID ${mbid} for "${ep.songTitle}" but not on spine yet`,
        );
        continue;
      }

      const stored = await storeBeatoClaim(mbid, ep);
      if (stored) {
        resolved++;
        console.info(
          `[lore] beato: stored claim for "${ep.artist} — ${ep.songTitle}" → ${mbid}`,
        );
      }
    } catch (err) {
      console.warn("[lore] beato: episode processing failed", ep.videoId, err);
    }
  }

  if (attempted > 0) {
    console.info(
      `[lore] beato: pass complete — ${attempted} attempted, ${resolved} new claims stored`,
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let started = false;
const timers: NodeJS.Timeout[] = [];

/** Start the background Beato claims job. Idempotent — safe to call once at boot. */
export function startBeatoJob(): void {
  if (started) return;
  started = true;

  const warmup = setTimeout(() => {
    void runPass();
    const interval = setInterval(() => void runPass(), RUN_EVERY_MS);
    timers.push(interval);
  }, WARMUP_MS);
  timers.push(warmup);

  console.info("[lore] beato job scheduled (15 min warmup, 24 h interval)");
}

/** Stop the job (tests / graceful shutdown). */
export function stopBeatoJob(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}

/**
 * Admin reset: retract all superseded Beato claims (those whose videoId is no
 * longer in the seed), clear the in-memory miss cache, clear persistent miss
 * sentinels for all current seed episodes, and immediately trigger a fresh
 * pass so corrected claims are re-inserted without waiting 24 h.
 *
 * Returns the number of stale rows deleted.
 */
export async function triggerBeatoReset(): Promise<number> {
  const deleted = await retractSupersededBeatoClaims();
  // Clear the in-memory miss cache so the upcoming pass re-checks every episode.
  missedEpisodes.clear();
  // Clear persistent miss sentinels for all current seed episodes so they
  // get a fresh retry cycle.
  await Promise.all(BEATO_EPISODES.map((ep) => clearMissSentinel(ep.videoId)));
  void runPass();
  return deleted;
}
