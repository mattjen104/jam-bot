import { db, pickersTable, picksTable, trackClaimsTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { fetchAlbumTracklist } from "@workspace/song-enrichment";
import { upsertPicker, logTracklist, type TracklistEntry } from "./picks.js";

/**
 * Classic Albums documentary-series adapter.
 *
 * The long-running Classic Albums series (Mercury Studios) is a "series"
 * picker: each featured album's canonical tracklist becomes a dated, ORDERED
 * run of picks — the album is rideable front-to-back exactly as the artists
 * sequenced it, with the episode as the human vouching layer.
 *
 *   pickedAt   = the episode's first-broadcast year
 *   ordinal    = the album's track position (rideable segues)
 *   sourceUrl  = the episode's official home (groups the run)
 *   externalId = classicalbums:{slug}:{ordinal} (idempotent re-ingest)
 *
 * On top of the picks, OFFICIAL per-track making-of clips (Mercury Studios'
 * own YouTube uploads — never unofficial rips) feed a transcript→claims
 * pipeline: timestamped, grounded facts about the song, each deep-linking to
 * the exact moment in the official clip that supports it. Full episodes are
 * not on YouTube (they stream on licensed services), so most albums carry
 * episode-level attribution only; clips exist for a subset.
 *
 * Tracklists come from MusicBrainz (recording MBIDs known up front, so every
 * pick lands on the spine at "recording_id" confidence). Ingest is bounded per
 * sync tick (MAX_ALBUMS_PER_SYNC) to honor the 1 req/sec MusicBrainz budget.
 */

export const CLASSIC_ALBUMS_HANDLE = "classic-albums";
const SERIES_HOME = "https://www.youtube.com/@MercuryStudios";

/** An official, per-track making-of clip from the Mercury Studios channel. */
export interface EpisodeClip {
  /** Official YouTube video id (Mercury Studios upload). */
  videoId: string;
  /** The album track the clip is about (matches the MB tracklist title). */
  trackTitle: string;
}

/** One featured episode: an album the series documented. Public record. */
export interface ClassicAlbumsEpisode {
  slug: string;
  artist: string;
  album: string;
  /** Year the episode first aired. */
  episodeYear: number;
  /** The episode's official page (or the series home when none exists). */
  watchUrl?: string;
  /** Official per-track clips, when Mercury Studios has published them. */
  clips?: EpisodeClip[];
}

/**
 * Hand-maintained episode seed (public record of the series' catalogue).
 * Kept deliberately small and famous — each entry costs 2 MusicBrainz calls.
 */
export const CLASSIC_ALBUMS_EPISODES: ClassicAlbumsEpisode[] = [
  {
    slug: "rio",
    artist: "Duran Duran",
    album: "Rio",
    episodeYear: 2021,
    clips: [
      { videoId: "XN1fCcEkjyI", trackTitle: "Rio" },
      { videoId: "___KbZneQ1s", trackTitle: "Hungry like the Wolf" },
      { videoId: "BHAVsWksQLA", trackTitle: "Save a Prayer" },
    ],
  },
  { slug: "rumours", artist: "Fleetwood Mac", album: "Rumours", episodeYear: 1997 },
  { slug: "nevermind", artist: "Nirvana", album: "Nevermind", episodeYear: 2005 },
  {
    slug: "dark-side-of-the-moon",
    artist: "Pink Floyd",
    album: "The Dark Side of the Moon",
    episodeYear: 2003,
  },
  {
    slug: "songs-in-the-key-of-life",
    artist: "Stevie Wonder",
    album: "Songs in the Key of Life",
    episodeYear: 1997,
  },
  { slug: "graceland", artist: "Paul Simon", album: "Graceland", episodeYear: 1997 },
  { slug: "transformer", artist: "Lou Reed", album: "Transformer", episodeYear: 2001 },
  { slug: "whos-next", artist: "The Who", album: "Who’s Next", episodeYear: 1999 },
  { slug: "catch-a-fire", artist: "Bob Marley & The Wailers", album: "Catch a Fire", episodeYear: 1999 },
  { slug: "metallica", artist: "Metallica", album: "Metallica", episodeYear: 2001 },
  {
    slug: "goodbye-yellow-brick-road",
    artist: "Elton John",
    album: "Goodbye Yellow Brick Road",
    episodeYear: 2001,
  },
  { slug: "hunting-high-and-low", artist: "a‐ha", album: "Hunting High and Low", episodeYear: 2010 },
];

/** Episodes newest-first is NOT wanted here — seed order is curated. */
const MAX_ALBUMS_PER_SYNC = 2;

/** Register the Classic Albums series picker (idempotent; no network). */
export async function seedClassicAlbumsPicker(): Promise<void> {
  await upsertPicker({
    pickerType: "series",
    name: "Classic Albums",
    handle: CLASSIC_ALBUMS_HANDLE,
    homeUrl: SERIES_HOME,
    trustTier: 2,
    description:
      "The Classic Albums documentary series — every featured album's tracklist, rideable in the order the artists sequenced it, with the episode as the vouching layer.",
  });
}

/**
 * Completed-episode ledger, kept in the picker's `sourceRef` so skipping is
 * COMPLETION-based rather than existence-based: a crash mid-tracklist leaves
 * picks behind but no ledger entry, and the next tick re-runs the (idempotent)
 * ingest to fill the gap instead of permanently skipping a half-done album.
 */
export function completedSlugs(sourceRef: unknown): string[] {
  if (!sourceRef || typeof sourceRef !== "object") return [];
  const raw = (sourceRef as Record<string, unknown>).completedSlugs;
  return Array.isArray(raw) ? raw.filter((s) => typeof s === "string") : [];
}

async function markEpisodeComplete(
  pickerId: number,
  sourceRef: unknown,
  slug: string,
): Promise<void> {
  const done = completedSlugs(sourceRef);
  if (done.includes(slug)) return;
  const base =
    sourceRef && typeof sourceRef === "object"
      ? (sourceRef as Record<string, unknown>)
      : {};
  await db
    .update(pickersTable)
    .set({ sourceRef: { ...base, completedSlugs: [...done, slug] } })
    .where(eq(pickersTable.id, pickerId));
}

/**
 * One bounded sync tick: ingest up to MAX_ALBUMS_PER_SYNC not-yet-ingested
 * episodes' album tracklists as ordered picks. Resumable — re-runs skip
 * ingested episodes via the externalId probe, so the seed list fills in over
 * a few ticks without bursting MusicBrainz. Never throws.
 */
export async function syncClassicAlbums(): Promise<{
  albumsIngested: number;
  logged: number;
}> {
  let albumsIngested = 0;
  let logged = 0;
  try {
    const picker = await db
      .select()
      .from(pickersTable)
      .where(eq(pickersTable.handle, CLASSIC_ALBUMS_HANDLE))
      .limit(1);
    const p = picker[0];
    if (!p) return { albumsIngested, logged };
    let ledger: unknown = p.sourceRef;

    for (const ep of CLASSIC_ALBUMS_EPISODES) {
      if (albumsIngested >= MAX_ALBUMS_PER_SYNC) break;
      if (completedSlugs(ledger).includes(ep.slug)) continue;

      const tracklist = await fetchAlbumTracklist(ep.artist, ep.album);
      if (!tracklist) {
        console.warn("[lore] classic-albums: no tracklist for", ep.slug);
        continue;
      }

      const watchUrl = ep.watchUrl ?? SERIES_HOME;
      const context = `Classic Albums — ${tracklist.releaseTitle} (${ep.episodeYear} episode)`;
      const entries: TracklistEntry[] = tracklist.tracks.map((t) => ({
        artist: t.artist ?? ep.artist,
        title: t.title,
        recordingId: t.recordingId,
        externalId: `classicalbums:${ep.slug}:${t.position}`,
      }));
      const r = await logTracklist({
        pickerId: p.id,
        source: "series_episode",
        entries,
        ordered: true,
        sourceUrl: watchUrl,
        context,
      });
      albumsIngested += 1;
      logged += r.logged;
      // Every entry was attempted without throwing — record completion so
      // future ticks skip this album cheaply. A crash before this line leaves
      // no ledger entry, and the next tick retries the whole (idempotent) run.
      await markEpisodeComplete(p.id, ledger, ep.slug);
      ledger = {
        ...(ledger && typeof ledger === "object"
          ? (ledger as Record<string, unknown>)
          : {}),
        completedSlugs: [...completedSlugs(ledger), ep.slug],
      };
      console.info(
        `[lore] classic-albums ${ep.slug}: +${r.logged}/${r.total} pick(s), ${r.resolved} resolved`,
      );
    }
  } catch (err) {
    console.error("[lore] classic-albums sync failed", err);
  }
  return { albumsIngested, logged };
}

// ---- Transcript → grounded claims (official clips only) ----

/** One timed caption cue from an official clip's transcript. */
export interface CaptionCue {
  /** Seconds from the start of the clip. */
  tSec: number;
  text: string;
}

const YT_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Pure: parse a YouTube timedtext body into cues. Handles both the classic
 * `<text start= dur=>` format and the srv3 `<p t= d=>` format.
 */
export function parseCaptionXml(xml: string): CaptionCue[] {
  let cues = [
    ...xml.matchAll(/<text start="([\d.]+)" dur="[\d.]+"[^>]*>([\s\S]*?)<\/text>/g),
  ].map((m) => ({
    tSec: Math.round(parseFloat(m[1]!)),
    text: decodeEntities(m[2]!.replace(/<[^>]+>/g, "")),
  }));
  if (!cues.length) {
    cues = [...xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => ({
      tSec: Math.round(parseInt(m[1]!, 10) / 1000),
      text: decodeEntities(m[2]!.replace(/<[^>]+>/g, "")),
    }));
  }
  return cues.filter((c) => c.text);
}

/**
 * Fetch an official clip's caption track (the transcript). Uses YouTube's
 * public innertube player endpoint; returns [] when the clip has no captions
 * or on any failure — never throws. Transcript text is processed in memory
 * only and never stored.
 */
export async function fetchVideoCaptions(
  videoId: string,
): Promise<{ title: string | null; cues: CaptionCue[] }> {
  try {
    const r = await fetch("https://youtubei.googleapis.com/youtubei/v1/player", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": YT_UA },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
            androidSdkVersion: 34,
            hl: "en",
            osName: "Android",
            osVersion: "14",
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    if (!r.ok) return { title: null, cues: [] };
    const j = (await r.json()) as {
      videoDetails?: { title?: string };
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: Array<{ baseUrl?: string; kind?: string }>;
        };
      };
    };
    const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = tracks.find((t) => t.baseUrl) ?? null;
    if (!track?.baseUrl) return { title: j.videoDetails?.title ?? null, cues: [] };
    const cr = await fetch(track.baseUrl, { headers: { "User-Agent": YT_UA } });
    if (!cr.ok) return { title: j.videoDetails?.title ?? null, cues: [] };
    const xml = await cr.text();
    return { title: j.videoDetails?.title ?? null, cues: parseCaptionXml(xml) };
  } catch (err) {
    console.warn("[lore] classic-albums caption fetch failed", videoId, err);
    return { title: null, cues: [] };
  }
}

/** A claim extracted from a transcript, pending the grounding guard. */
export interface ExtractedClaim {
  text: string;
  /** Second offset of the transcript moment that supports the claim. */
  tSec: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "to", "was", "were", "is",
  "are", "it", "that", "this", "for", "with", "at", "by", "from", "as", "be",
  "we", "they", "he", "she", "you", "i", "his", "her", "their", "our", "its",
  "had", "has", "have", "but", "not", "so", "just", "very", "into", "about",
  "song", "track", "album", "record", "recording", "band", "music",
]);

function contentTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Pure grounding guard: a claim is grounded when enough of its content words
 * actually appear in the transcript window around its cited moment. Mirrors
 * the never-fabricate rule from the liner-notes pipeline — an LLM paraphrase
 * that drifts from what was said gets rejected, not published.
 */
export function claimIsGrounded(
  claimText: string,
  cues: CaptionCue[],
  tSec: number,
  windowSec = 90,
): boolean {
  const window = cues
    .filter((c) => Math.abs(c.tSec - tSec) <= windowSec)
    .map((c) => c.text)
    .join(" ");
  if (!window) return false;
  const claimTokens = contentTokens(claimText);
  if (claimTokens.length < 3) return false;

  // Numbers are where paraphrase turns into fabrication (years, chart
  // positions, take counts): EVERY digit-run in the claim must literally
  // appear in the transcript window, no exceptions.
  const claimNumbers = claimText.match(/\d+/g) ?? [];
  if (claimNumbers.length > 0) {
    const windowNumbers = new Set(window.match(/\d+/g) ?? []);
    if (!claimNumbers.every((n) => windowNumbers.has(n))) return false;
  }

  const windowTokens = new Set(contentTokens(window));
  const hits = claimTokens.filter((t) => windowTokens.has(t)).length;
  return hits / claimTokens.length >= 0.5;
}

/**
 * Ask the LLM for grounded claims from a clip transcript. Uses the workspace
 * AI integration (OpenAI-compatible). Returns [] when unconfigured or on any
 * failure — the pipeline is strictly best-effort.
 */
export async function extractClaims(args: {
  artist: string;
  trackTitle: string;
  cues: CaptionCue[];
  maxClaims?: number;
}): Promise<ExtractedClaim[]> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey || !args.cues.length) return [];
  const maxClaims = args.maxClaims ?? 6;

  const transcript = args.cues
    .map((c) => `[${c.tSec}] ${c.text}`)
    .join("\n")
    .slice(0, 24000);

  const system =
    "You extract verifiable production/songwriting facts from a music documentary transcript. " +
    "Rules: every claim must be directly supported by the transcript — no outside knowledge, no inference beyond what is said. " +
    "Each claim cites the [second] marker of the supporting line. Write each claim as one short standalone sentence " +
    "using the speakers' own key terms. Skip praise, vibes, and anything not factual. " +
    'Respond with JSON: {"claims":[{"text":"...","tSec":123}]}';

  const user =
    `Artist: ${args.artist}\nTrack: ${args.trackTitle}\n` +
    `Extract up to ${maxClaims} grounded claims about how this song was written/recorded/produced.\n\n` +
    `Transcript (each line prefixed with its [second] offset):\n${transcript}`;

  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      console.warn("[lore] classic-albums extraction http", r.status);
      return [];
    }
    const body = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content) as {
      claims?: Array<{ text?: string; tSec?: number }>;
    };
    return (parsed.claims ?? [])
      .filter(
        (c): c is { text: string; tSec: number } =>
          typeof c.text === "string" &&
          c.text.trim().length > 0 &&
          typeof c.tSec === "number" &&
          c.tSec >= 0,
      )
      .slice(0, maxClaims)
      .map((c) => ({ text: c.text.trim(), tSec: Math.round(c.tSec) }));
  } catch (err) {
    console.warn("[lore] classic-albums extraction failed", err);
    return [];
  }
}

/** True when a clip already has stored claims (idempotent re-runs skip it). */
async function clipProcessed(videoId: string): Promise<boolean> {
  const probe = await db
    .select({ id: trackClaimsTable.id })
    .from(trackClaimsTable)
    .where(like(trackClaimsTable.externalId, `yt:${videoId}:%`))
    .limit(1);
  return probe.length > 0;
}

/** The MBID a clip's track resolved to, via the episode's ingested picks. */
async function clipTrackMbid(
  pickerId: number,
  slug: string,
  trackTitle: string,
): Promise<string | null> {
  const rows = await db
    .select({ mbid: picksTable.mbid, rawTitle: picksTable.rawTitle })
    .from(picksTable)
    .where(
      and(
        eq(picksTable.pickerId, pickerId),
        like(picksTable.externalId, `classicalbums:${slug}:%`),
      ),
    );
  const want = trackTitle.trim().toLowerCase();
  for (const r of rows) {
    if (r.mbid && r.rawTitle?.trim().toLowerCase() === want) return r.mbid;
  }
  return null;
}

/**
 * The full pilot pipeline for one episode's official clips: transcript →
 * LLM extraction → grounding guard → stored claims with timestamped watch
 * links. Skips clips already processed and tracks not yet on the spine.
 * Never throws.
 */
export async function processEpisodeClips(
  ep: ClassicAlbumsEpisode,
): Promise<{ clipsProcessed: number; claimsStored: number }> {
  let clipsProcessed = 0;
  let claimsStored = 0;
  if (!ep.clips?.length) return { clipsProcessed, claimsStored };
  try {
    const picker = await db
      .select()
      .from(pickersTable)
      .where(eq(pickersTable.handle, CLASSIC_ALBUMS_HANDLE))
      .limit(1);
    const p = picker[0];
    if (!p) return { clipsProcessed, claimsStored };

    for (const clip of ep.clips) {
      if (await clipProcessed(clip.videoId)) continue;
      const mbid = await clipTrackMbid(p.id, ep.slug, clip.trackTitle);
      if (!mbid) continue;

      const { cues } = await fetchVideoCaptions(clip.videoId);
      if (!cues.length) continue;
      const extracted = await extractClaims({
        artist: ep.artist,
        trackTitle: clip.trackTitle,
        cues,
      });
      const grounded = extracted.filter((c) =>
        claimIsGrounded(c.text, cues, c.tSec),
      );
      if (!grounded.length) {
        clipsProcessed += 1;
        continue;
      }

      const sourceLabel = `Classic Albums: ${ep.album}`;
      const values = grounded.map((c, i) => ({
        mbid,
        positionMs: null,
        text: c.text,
        sourceLabel,
        sourceUrl: `https://www.youtube.com/watch?v=${clip.videoId}&t=${c.tSec}s`,
        sourceHandle: CLASSIC_ALBUMS_HANDLE,
        externalId: `yt:${clip.videoId}:${i}`,
      }));
      const inserted = await db
        .insert(trackClaimsTable)
        .values(values)
        .onConflictDoNothing({ target: trackClaimsTable.externalId })
        .returning({ id: trackClaimsTable.id });
      clipsProcessed += 1;
      claimsStored += inserted.length;
      console.info(
        `[lore] classic-albums claims ${clip.videoId} (${clip.trackTitle}): +${inserted.length}`,
      );
    }
  } catch (err) {
    console.error("[lore] classic-albums claims pipeline failed", ep.slug, err);
  }
  return { clipsProcessed, claimsStored };
}

// ---- Boot task (slow, in-process — mirrors the NTS poller pattern) ----

const SYNC_POLL_MS = 30 * 60 * 1000;
const WARMUP_MS = 150_000;

let started = false;
const timers: NodeJS.Timeout[] = [];

async function tick(): Promise<void> {
  const r = await syncClassicAlbums();
  if (r.logged > 0) {
    console.info(
      `[lore] classic-albums: +${r.logged} pick(s) across ${r.albumsIngested} album(s)`,
    );
  }
  for (const ep of CLASSIC_ALBUMS_EPISODES) {
    if (!ep.clips?.length) continue;
    await processEpisodeClips(ep);
  }
}

/**
 * Start the Classic Albums ingest loop. Idempotent — safe to call once at
 * boot. Each tick ingests a bounded number of albums and processes any
 * unprocessed official clips, so the catalogue fills in gradually.
 */
export function startClassicAlbumsPoller(): void {
  if (started) return;
  started = true;
  const kickoff = setTimeout(() => {
    void tick().catch((err) =>
      console.error("[lore] classic-albums tick failed", err),
    );
    const interval = setInterval(
      () =>
        void tick().catch((err) =>
          console.error("[lore] classic-albums tick failed", err),
        ),
      SYNC_POLL_MS,
    );
    timers.push(interval);
  }, WARMUP_MS);
  timers.push(kickoff);
}

/** Stop the poller (tests / graceful shutdown). */
export function stopClassicAlbumsPoller(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
