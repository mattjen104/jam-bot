import { db, pickersTable, songExploderEpisodesTable, trackClaimsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { parseFeedItems } from "./blog.js";
import { upsertPicker, persistPick } from "./picks.js";

/**
 * Song Exploder episode → MBID pipeline.
 *
 * Song Exploder deconstructs a single song per episode. The RSS feed gives us
 * a live "Artist, Song Title" list that resolves to MusicBrainz Recording IDs.
 * A musician talking about their own track is the highest possible attribution
 * source, so the picker lands at trust_tier=1 alongside labels.
 *
 * Pipeline:
 *   1. RSS fetch → parse episodes → upsert into song_exploder_episodes
 *   2. For each unresolved episode: parse artist+title, call persistPick
 *   3. On resolution: update song_exploder_episodes.mbid + resolved_at
 *   4. Picks surface as a `series` picker on the recording's Song page
 *
 * Admin claim path (separate, in the routes layer):
 *   POST /admin/song-exploder/:episodeId/claims  →  track_claims row
 */

export const SONG_EXPLODER_HANDLE = "song-exploder";
const FEED_URL = "https://feed.songexploder.net/SongExploder";
const EPISODE_HOME = "https://songexploder.net";
const FEED_TIMEOUT_MS = 12_000;

// Song Exploder publishes roughly weekly — poll every 6 hours.
const POLL_MS = 6 * 60 * 60 * 1000;
// Let the heavy boot work (stations, backfill) settle before the first pull.
const WARMUP_MS = 90_000;

// ---- Picker registration -----------------------------------------------

/** Register the Song Exploder series picker (idempotent; no network). */
export async function seedSongExploderPicker(): Promise<void> {
  await upsertPicker({
    pickerType: "series",
    name: "Song Exploder",
    handle: SONG_EXPLODER_HANDLE,
    homeUrl: EPISODE_HOME,
    trustTier: 1,
    description:
      "Song Exploder — musicians deconstruct their own songs in detail. " +
      "A musician speaking about their own track is the highest possible attribution source.",
  });
}

// ---- Title parsing ---------------------------------------------------------

/**
 * Pure: parse an episode title into artist + song title.
 *
 * Song Exploder RSS titles come in several shapes:
 *   - "Doja Cat, Need to Know"          (comma, no quotes)
 *   - "Radiohead, 'Karma Police'"        (comma, single-quoted title)
 *   - "Nine Inch Nails, \"Hurt\""        (comma, double-quoted title)
 *   - "The xx - On Hold"                 (dash variant — some older eps)
 *
 * Returns null when no confident split is found; the caller skips rather than
 * guessing.
 */
export function parseSongExploderTitle(
  raw: string,
): { artist: string; title: string } | null {
  const s = raw.trim();
  if (!s) return null;

  // Shape 1: "Artist, Song Title" — comma-separated (primary Song Exploder format).
  // Strip optional surrounding quotes from the song portion.
  const commaIdx = s.indexOf(",");
  if (commaIdx > 0 && commaIdx < s.length - 2) {
    const artist = s.slice(0, commaIdx).trim();
    let title = s.slice(commaIdx + 1).trim();
    // Strip wrapping quotes (single or double, curly or straight).
    title = title.replace(/^["""'''\u2018\u2019\u201c\u201d]+|["""'''\u2018\u2019\u201c\u201d]+$/g, "").trim();
    if (artist && title && artist.length <= 120 && title.length <= 200) {
      return { artist, title };
    }
  }

  // Shape 2: "Artist – Song Title" / "Artist - Song Title" (dash/em-dash).
  const dashMatch = s.match(/^(.+?)\s+[–—\-]\s+(.+)$/);
  if (dashMatch) {
    const artist = dashMatch[1]!.trim();
    const title = dashMatch[2]!.trim();
    if (artist && title && artist.length <= 120 && title.length <= 200) {
      return { artist, title };
    }
  }

  return null;
}

// ---- Enclosure URL extraction from a raw RSS block -------------------------

/** Extract an audio enclosure URL from an RSS <item> block. */
function extractEnclosureUrl(block: string): string | null {
  const m = block.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  return m ? m[1]! : null;
}

// ---- RSS ingest ------------------------------------------------------------

export interface SongExploderIngestResult {
  fetched: number;
  upserted: number;
  resolved: number;
}

/**
 * Fetch the Song Exploder RSS feed, upsert new episodes into
 * song_exploder_episodes, and resolve unresolved episodes to the MBID spine.
 *
 * Idempotent: episodes dedup by externalId; resolved rows are skipped.
 * Never throws — failures are logged and the result reflects what succeeded.
 */
export async function syncSongExploderEpisodes(): Promise<SongExploderIngestResult> {
  const result: SongExploderIngestResult = { fetched: 0, upserted: 0, resolved: 0 };

  // ---- Step 1: fetch the picker (must exist before we can log picks) ------
  const pickerRows = await db
    .select()
    .from(pickersTable)
    .where(eq(pickersTable.handle, SONG_EXPLODER_HANDLE))
    .limit(1);
  const picker = pickerRows[0];
  if (!picker) {
    console.warn("[lore] song-exploder: picker not seeded yet, skipping sync");
    return result;
  }

  // ---- Step 2: fetch + parse RSS -----------------------------------------
  let xmlBody: string;
  try {
    const res = await fetch(FEED_URL, {
      headers: { Accept: "application/rss+xml, application/atom+xml, text/xml" },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    xmlBody = await res.text();
  } catch (err) {
    console.error("[lore] song-exploder: feed fetch failed", err);
    return result;
  }

  // Re-parse with the item blocks extracted from the raw XML so we can also
  // grab <enclosure> URLs which parseFeedItems doesn't expose.
  const items = parseFeedItems(xmlBody);
  result.fetched = items.length;

  // Extract enclosure URL per item: we match item blocks in the same order
  // parseFeedItems emits them (order is preserved in RSS).
  const itemBlockRe = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi;
  const enclosureByLink = new Map<string, string>();
  let mb: RegExpExecArray | null;
  while ((mb = itemBlockRe.exec(xmlBody))) {
    const block = mb[2]!;
    const url = extractEnclosureUrl(block);
    if (url) {
      // Keyed on the link so we can join back to parseFeedItems output.
      const linkMatch = block.match(/<link[^>]*>([^<]+)<\/link>/i) || block.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (linkMatch) enclosureByLink.set(linkMatch[1]!.trim(), url);
    }
  }

  // ---- Step 3: upsert episodes -------------------------------------------
  for (const item of items) {
    const externalId = `se:${item.guid}`;
    try {
      await db
        .insert(songExploderEpisodesTable)
        .values({
          externalId,
          title: item.title,
          episodeUrl: item.link,
          audioUrl: enclosureByLink.get(item.link) ?? null,
          publishedAt: item.publishedAt ?? null,
        })
        .onConflictDoNothing({ target: songExploderEpisodesTable.externalId });
      result.upserted++;
    } catch (err) {
      console.error("[lore] song-exploder: episode upsert failed", item.guid, err);
    }
  }

  // ---- Step 4: resolve unresolved episodes --------------------------------
  const unresolved = await db
    .select()
    .from(songExploderEpisodesTable)
    .where(isNull(songExploderEpisodesTable.mbid));

  for (const ep of unresolved) {
    const parsed = parseSongExploderTitle(ep.title);
    if (!parsed) {
      // No confident parse — leave in unresolved queue for manual review.
      continue;
    }

    try {
      const { resolution } = await persistPick({
        pickerId: picker.id,
        source: "series_episode",
        rawArtist: parsed.artist,
        rawTitle: parsed.title,
        sourceUrl: ep.episodeUrl,
        context: `Song Exploder — ${ep.title}`,
        externalId: ep.externalId,
        ...(ep.publishedAt ? { pickedAt: ep.publishedAt } : {}),
      });

      if (resolution.mbid) {
        // Stamp the episode row so future ticks skip it.
        await db
          .update(songExploderEpisodesTable)
          .set({ mbid: resolution.mbid, resolvedAt: new Date() })
          .where(
            and(
              eq(songExploderEpisodesTable.id, ep.id),
              isNull(songExploderEpisodesTable.mbid),
            ),
          );
        result.resolved++;
        console.info(
          `[lore] song-exploder: resolved "${ep.title}" → ${resolution.mbid} (${resolution.confidence})`,
        );
      }
    } catch (err) {
      console.error("[lore] song-exploder: resolution failed for", ep.title, err);
    }
  }

  return result;
}

// ---- Admin claim entry (called from route layer) --------------------------

export interface SongExploderClaimInput {
  episodeId: number;
  offsetMs?: number | null;
  text: string;
  sourceUrl: string;
}

export interface SongExploderClaimResult {
  claimId: number;
  mbid: string;
  episodeTitle: string;
}

/**
 * Attach a timestamp-anchored claim to the recording resolved from a Song
 * Exploder episode. The claim is paraphrased by the admin (never verbatim
 * transcript text) and deep-links to the episode so every fact is one tap
 * from its evidence.
 *
 * Throws when the episode doesn't exist or hasn't been resolved yet — callers
 * should surface these as 404/409 respectively.
 */
export async function addSongExploderClaim(
  input: SongExploderClaimInput,
): Promise<SongExploderClaimResult> {
  const [episode] = await db
    .select()
    .from(songExploderEpisodesTable)
    .where(eq(songExploderEpisodesTable.id, input.episodeId))
    .limit(1);

  if (!episode) {
    throw Object.assign(new Error("Episode not found"), { status: 404 });
  }
  if (!episode.mbid) {
    throw Object.assign(
      new Error("Episode not yet resolved to a recording — resolve it first"),
      { status: 409 },
    );
  }

  // Build a stable externalId for idempotent re-entry: se:{episodeId}:claim:{hash}
  // We use a simple hash of the text so re-submitting the same text is a no-op.
  const textHash = Buffer.from(input.text).toString("base64url").slice(0, 16);
  const externalId = `se:${input.episodeId}:claim:${textHash}`;

  const [row] = await db
    .insert(trackClaimsTable)
    .values({
      mbid: episode.mbid,
      positionMs: input.offsetMs ?? null,
      text: input.text,
      sourceLabel: `Song Exploder — ${episode.title}`,
      sourceUrl: input.sourceUrl,
      sourceHandle: SONG_EXPLODER_HANDLE,
      externalId,
    })
    .onConflictDoUpdate({
      target: trackClaimsTable.externalId,
      set: {
        positionMs: input.offsetMs ?? null,
        text: input.text,
        sourceUrl: input.sourceUrl,
      },
    })
    .returning({ id: trackClaimsTable.id });

  if (!row) throw new Error("Claim insert returned no row");

  return { claimId: row.id, mbid: episode.mbid, episodeTitle: episode.title };
}

// ---- Poller ----------------------------------------------------------------

let started = false;
const timers: NodeJS.Timeout[] = [];

async function tick(): Promise<void> {
  try {
    const r = await syncSongExploderEpisodes();
    if (r.upserted > 0 || r.resolved > 0) {
      console.info(
        `[lore] song-exploder: ${r.fetched} fetched, ${r.upserted} upserted, ${r.resolved} resolved`,
      );
    }
  } catch (err) {
    console.error("[lore] song-exploder tick failed", err);
  }
}

/**
 * Start the Song Exploder feed poller. Idempotent — safe to call once at
 * boot. Polls every 6 hours after an initial warmup delay.
 */
export function startSongExploderPoller(): void {
  if (started) return;
  started = true;
  const kickoff = setTimeout(() => {
    void tick();
    const interval = setInterval(() => void tick(), POLL_MS);
    timers.push(interval);
  }, WARMUP_MS);
  timers.push(kickoff);
}

/** Stop the poller (tests / graceful shutdown). */
export function stopSongExploderPoller(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
