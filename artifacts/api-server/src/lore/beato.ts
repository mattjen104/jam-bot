import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

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
 *   4. Miss sentinel prevents re-checking on every pass.
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
 * Seeded with Smashing Pumpkins / Mellon Collie entries as the primary
 * smoke-test for the Task 135 metadata expansion (30th anniversary).
 * Add episodes by copying the YouTube video id and official title.
 *
 * NOTE: video IDs should be verified against the @RickBeato YouTube channel
 * before updating this seed. The artist+songTitle pairs are the canonical
 * facts; the videoId only affects the watch link in the stored claim.
 */
export const BEATO_EPISODES: BeatoEpisode[] = [
  // ---- Smashing Pumpkins — Mellon Collie 30th smoke tests ----
  {
    videoId: "C4nK3t9CJl4",
    artist: "The Smashing Pumpkins",
    songTitle: "Bullet with Butterfly Wings",
    youtubeUrl: "https://www.youtube.com/watch?v=C4nK3t9CJl4",
  },
  {
    videoId: "wr5uYYfqSXQ",
    artist: "The Smashing Pumpkins",
    songTitle: "1979",
    youtubeUrl: "https://www.youtube.com/watch?v=wr5uYYfqSXQ",
  },
  // ---- Additional well-documented episodes ----
  {
    videoId: "4vHCNKBfTTw",
    artist: "Nirvana",
    songTitle: "Smells Like Teen Spirit",
    youtubeUrl: "https://www.youtube.com/watch?v=4vHCNKBfTTw",
  },
  {
    videoId: "UmGjxpWYW5g",
    artist: "Radiohead",
    songTitle: "Karma Police",
    youtubeUrl: "https://www.youtube.com/watch?v=UmGjxpWYW5g",
  },
  {
    videoId: "9YkGnTNWkBQ",
    artist: "Led Zeppelin",
    songTitle: "Stairway to Heaven",
    youtubeUrl: "https://www.youtube.com/watch?v=9YkGnTNWkBQ",
  },
  {
    videoId: "lbwgbYMZs2w",
    artist: "Pink Floyd",
    songTitle: "Comfortably Numb",
    youtubeUrl: "https://www.youtube.com/watch?v=lbwgbYMZs2w",
  },
  {
    videoId: "GgTZKKn2OFo",
    artist: "Fleetwood Mac",
    songTitle: "The Chain",
    youtubeUrl: "https://www.youtube.com/watch?v=GgTZKKn2OFo",
  },
  {
    videoId: "8kqANgCeHCc",
    artist: "The Police",
    songTitle: "Every Breath You Take",
    youtubeUrl: "https://www.youtube.com/watch?v=8kqANgCeHCc",
  },
  {
    videoId: "Hs6Q8o4NYNM",
    artist: "Michael Jackson",
    songTitle: "Billie Jean",
    youtubeUrl: "https://www.youtube.com/watch?v=Hs6Q8o4NYNM",
  },
  {
    videoId: "k2RnGsRYKr8",
    artist: "Eagles",
    songTitle: "Hotel California",
    youtubeUrl: "https://www.youtube.com/watch?v=k2RnGsRYKr8",
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
 * Search MusicBrainz for a recording MBID by artist + title.
 * Returns the best match when MB score ≥ 85, null otherwise.
 * Never throws — returns null on any failure.
 */
export async function resolveRecordingMbid(
  artist: string,
  songTitle: string,
): Promise<string | null> {
  try {
    await mbSleep();
    const query = `recording:"${songTitle.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}"`;
    const url = `${MB_API}/recording?query=${encodeURIComponent(query)}&limit=3&fmt=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": MB_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      recordings?: Array<{ id?: string; score?: number }>;
    };
    const hit = body.recordings?.[0];
    if (!hit?.id) return null;
    // Only accept high-confidence matches (MB score ≥ 85).
    if ((hit.score ?? 0) < 85) return null;
    return hit.id;
  } catch {
    return null;
  }
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
// In-memory miss cooldown (avoids repeated MB lookups for unresolvable entries)
// ---------------------------------------------------------------------------

const missedEpisodes = new Set<string>(); // videoId values that missed on last pass

// ---------------------------------------------------------------------------
// Per-pass runner
// ---------------------------------------------------------------------------

async function runPass(): Promise<void> {
  let attempted = 0;
  let resolved = 0;

  for (const ep of BEATO_EPISODES) {
    // Skip episodes that already had a miss on this server run.
    if (missedEpisodes.has(ep.videoId)) continue;

    try {
      // Idempotency: skip if any beato claim (hit or miss) already exists for this video.
      const existing = await db
        .select({ id: trackClaimsTable.id })
        .from(trackClaimsTable)
        .where(
          and(
            eq(trackClaimsTable.sourceHandle, BEATO_HANDLE),
            // Match either the hit key or the miss-sentinel key.
            eq(trackClaimsTable.externalId, `beato:${ep.videoId}`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      // Also check the miss sentinel.
      const existingMiss = await db
        .select({ id: trackClaimsTable.id })
        .from(trackClaimsTable)
        .where(eq(trackClaimsTable.externalId, `beato:${ep.videoId}:checked`))
        .limit(1);
      if (existingMiss.length > 0) {
        missedEpisodes.add(ep.videoId);
        continue;
      }

      attempted++;
      const mbid = await resolveRecordingMbid(ep.artist, ep.songTitle);

      if (!mbid) {
        missedEpisodes.add(ep.videoId);
        console.info(
          `[lore] beato: no MB match for "${ep.artist} — ${ep.songTitle}"`,
        );
        // Don't store a sentinel — no valid mbid to reference.
        continue;
      }

      // Verify the recording row exists in our spine before inserting claim.
      const [rec] = await db
        .select({ mbid: recordingsTable.mbid })
        .from(recordingsTable)
        .where(eq(recordingsTable.mbid, mbid))
        .limit(1);

      if (!rec) {
        // Recording not yet on the spine — skip for now, retry next pass.
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
