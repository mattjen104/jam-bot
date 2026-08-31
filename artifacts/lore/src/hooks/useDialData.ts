/**
 * useDialData — assembles all the data the Dial view needs in one place.
 *
 * Fetches:
 *   - station list (with live pulse)
 *   - rolling 24-hour schedule runs (show blocks per station, today + yesterday)
 *   - today's recent spins per station (for per-show display and chip timeline)
 *   - picker overlap + hasLibrary flag (server-side join, no MBID download)
 *
 * Station-level crossing scores come from GET /api/me/crossings, which runs a
 * true NOW() − 24h query server-side, so yesterday's spins are no longer needed
 * for ranking. Yesterday's schedule runs are still fetched so that overnight
 * shows that started before midnight appear in the timeline.
 *
 * Returns an enriched `DialStation[]` array. Sorting is intentionally left to
 * DialView, which applies the attribution-tier ladder: live crossing → named
 * selector (lifetime overlap count) → unattributed station (24h crossings).
 */
import { useMemo, useState, useEffect, useCallback } from "react";
import {
  useListStations,
  getListStationsQueryKey,
  useListStationsNowPlaying,
  getListStationsNowPlayingQueryKey,
  useGetStationsSchedule,
  getGetStationsScheduleQueryKey,
  useGetStationsRecentSpins,
  getGetStationsRecentSpinsQueryKey,
  useGetStationsArtistFrequency,
  getGetStationsArtistFrequencyQueryKey,
  type Station,
  type StationScheduleRun,
  type StationRecentSpin,
  type StationsArtistFrequencyItem,
} from "@workspace/api-client-react";
import { subscribeSpinStream } from "../webplayer/nowPlayingStream";
import { useMyPickerNames, useMyDialCrossings, useMyBlendedCrossings, useMyPickerOverlap, type DialCrossing } from "../lib/meHooks";
import { eligibleDjName, eligibleDjNames } from "@workspace/lore-attribution";
import { spinAgeTier, type AgeTier } from "../lib/dialAgeFilter";
import { gateLiveHitFlags } from "../lib/freshness";
import { useAddedStations } from "./useAddedStations";
import { addedStationToStation } from "../lib/addedStations";

// ---------------------------------------------------------------------------
// Shared name normaliser — strips zero-width chars, trims, collapses spaces.
// Used by useDialData (building pickerNameToId) and DialView (sort bridge).
// ---------------------------------------------------------------------------

export function normalizeDjName(s: string): string {
  return s
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "") // zero-width chars
    .trim()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface DialSpin {
  mbid: string | null;
  artistMbid: string | null;
  /** MusicBrainz release-group identity for album-level crossings and links. */
  releaseGroupMbid?: string | null;
  title: string;
  artist: string;
  playedAt: string;
  /**
   * Original source observation time when `playedAt` has been restamped for a
   * live UI affordance. Use this to compare track starts across stations;
   * `playedAt` remains the display/freshness clock for existing Dial surfaces.
   */
  sourcePlayedAt?: string;
  /** Exact recording or release-group match against user's library. */
  isLibraryHit: boolean;
  /** Artist is in the user's library but this exact track/album is not. */
  isArtistHit: boolean;
  /** First-ever appearance of this recording (by MBID) in the archive. */
  isFirstSpin: boolean;
  /** MusicBrainz first-release year for the recording; null when unknown/unresolved. */
  releaseYear: number | null;
  /** MusicBrainz first-release date in partial-ISO form; null when unknown/unresolved. */
  releaseDate?: string | null;
  /**
   * Age tier derived from releaseYear + isFirstSpin, powering the Dial's
   * First/Current/Catalog/Deep filter. Null when the release year is unknown
   * and the spin is not a first-play (such rows pass through the age filter).
   */
  ageTier: AgeTier | null;
  /**
   * True while this spin arrived via the provisional `spin-raw` fast path and
   * is still awaiting MusicBrainz resolution. A resolving entry must NEVER be
   * treated as a confirmed crossing — `isLibraryHit` and `isArtistHit` are
   * always false for provisional entries.
   */
  resolving?: boolean;
}

export interface DialShow {
  runId: number | string | null;
  showName: string;
  djName: string | null;
  /**
   * Co-host / multi-DJ names when the source provides them.  When present,
   * takes precedence over `djName` in attribution helpers.  Old single-DJ
   * sources that set only `djName` continue to work unchanged.
   */
  djNames?: string[];
  startedAt: string;
  endedAt: string;
  /** Station-local IANA timezone for this set; null only when unavailable. */
  ianaTimezone: string | null;
  /** visual state of the block */
  state: "live" | "past" | "future";
  spins: DialSpin[];
  /** Count of spins that exactly match the user's library (recording/album). */
  crossings: number;
  /** Count of spins by artists in the user's library (no exact track match). */
  artistCrossings: number;
  /** Up to 3 library-hit artist names (exact matches), for display. */
  topArtists: string[];
  /** Up to 3 artist-hit names (artist-only matches), for display. */
  topArtistNames: string[];
  /** last spin (if state=live) or null */
  currentTrack: DialSpin | null;
  isPickerShow: boolean;
  /** Picker id from the linked shows row — null when show has no picker attached. */
  pickerId: number | null;
}

export interface DialStation {
  station: Station;
  /** true when the station is airing right now */
  isLive: boolean;
  shows: DialShow[];
  /** rolling 24h exact-MBID/release-group crossings (used for Zone 1 eligibility threshold) */
  crossings: number;
  /** rolling 24h artist-level crossings (exact track not in library) */
  artistCrossings: number;
  /** First-ever Lore plays that are also crossings, in the rolling 24h window. */
  firstPlayCrossings: number;
  /** rolling 7-day exact-MBID/release-group crossings — sort key for Recent tab "Last Week" filter */
  weekCrossings: number;
  /** rolling 7-day artist-level crossings */
  weekArtistCrossings: number;
  /** First-ever Lore plays that are also crossings, in the rolling 7d window. */
  weekFirstPlayCrossings: number;
  /** rolling 30-day exact-MBID/release-group crossings — sort key for Recent tab "Last Month" filter */
  monthCrossings: number;
  /** rolling 30-day artist-level crossings */
  monthArtistCrossings: number;
  /** First-ever Lore plays that are also crossings, in the rolling 30d window. */
  monthFirstPlayCrossings: number;
  /** lifetime (all-time) exact-MBID/release-group crossings — primary sort key for unattributed rows */
  lifetimeCrossings: number;
  /** lifetime artist-level crossings — all-time equivalent of artistCrossings */
  lifetimeArtistCrossings: number;
  /** First-ever Lore plays that are also crossings, over the full archive. */
  lifetimeFirstPlayCrossings: number;
  /** Current track from the live pulse, even when schedule data is unavailable. */
  liveTrack?: DialSpin | null;
  /**
   * Top 5 crossing artist names for the provenance sentence.
   * In blended (party) mode these are cumulated across all active listeners
   * and come from the blended endpoint. In personal mode this is empty —
   * DialView reads per-show topArtists/topArtistNames instead.
   */
  topArtistNames: string[];
  /**
   * Top crossing artist names for the 24h window (personal mode only; up to 3).
   * Empty in blended mode — blended uses the flat topArtistNames instead.
   */
  topArtistNames24h: string[];
  /**
   * Top crossing artist names for the 7d window (personal mode only; up to 3).
   */
  topArtistNames7d: string[];
  /**
   * Top crossing artist names over all time (personal mode only; up to 3).
   */
  topArtistNamesLifetime: string[];
}

export interface LiveArtistSuggestion {
  /** Artist name as it appears in the current now-playing record. */
  artist: string;
  stationSlug: string;
  stationName: string | null;
  /** Best-effort context from the live show and track. */
  trackTitle: string | null;
  showName: string | null;
  /** Human selector/host when the current schedule attribution is usable. */
  djName: string | null;
  /** True for an artist sourced from the current live pulse. */
  live?: boolean;
  /** Historical Lore-wide play count, when this artist is in the frequency pool. */
  playCount?: number | null;
}

export type OnboardingArtistSuggestion = LiveArtistSuggestion & {
  live: boolean;
  playCount: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LIVE_WINDOW_MS = 20 * 60 * 1000; // 20 min — generous window for slow pollers
const FUTURE_THRESHOLD_MS = 60 * 1000; // 1 min lookahead
const LS_PINS_KEY = "lore:dialPins";

// A station is "live" only if its most-recent spin arrived within the last
// 60 minutes. The now-playing endpoint returns the all-time latest spin per
// station, so a stale entry (hours/days old) must not be treated as currently
// on-air. 60 min is generous enough to cover slow-polling hosts while still
// reliably excluding stations that are genuinely off-air.
// NB: different from LIVE_WINDOW_MS (20 min show-state window) above.
export const LIVE_PULSE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Scan lens now-playing map: only entries whose observation is inside the
 * 60-minute live-pulse window.
 *
 * `rest` must carry the SOURCE observation time in `playedAt` (the shared
 * `nowPlayingBySlug` map stamps REST rows with ~now for live-chip display,
 * which would make stale entries look fresh — never pass it here). SSE rows
 * carry their event `playedAt`, which is already the honest spin time.
 *
 * Pure and exported so the freshness gate is unit-testable without the hook.
 */
export function buildScanNowPlaying(
  rest: ReadonlyMap<string, DialSpin>,
  sseFinal: ReadonlyMap<string, DialSpin>,
  nowMs: number,
): Map<string, DialSpin> {
  const isFresh = (playedAt: string): boolean => {
    const t = new Date(playedAt).getTime();
    return !Number.isNaN(t) && nowMs - t <= LIVE_PULSE_WINDOW_MS;
  };
  const m = new Map<string, DialSpin>();
  for (const [slug, spin] of rest) {
    if (isFresh(spin.playedAt)) m.set(slug, spin);
  }
  // SSE rows win over the REST baseline, mirroring nowPlayingBySlug's merge.
  for (const [slug, spin] of sseFinal) {
    if (isFresh(spin.playedAt)) m.set(slug, spin);
  }
  return m;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayStr() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function readPins(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_PINS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function togglePin(slug: string): void {
  const pins = readPins();
  if (pins.has(slug)) pins.delete(slug);
  else pins.add(slug);
  try {
    localStorage.setItem(LS_PINS_KEY, JSON.stringify([...pins]));
  } catch {
    // ignore
  }
}

function showState(run: StationScheduleRun, isStationLive: boolean): "live" | "past" | "future" {
  const now = Date.now();
  const startMs = new Date(run.startedAt).getTime();
  const endMs = new Date(run.endedAt).getTime();
  // Future: hasn't started yet (with 1-min grace)
  if (startMs > now + FUTURE_THRESHOLD_MS) return "future";
  // Live: station is live and the show's end is within the live window
  if (isStationLive && endMs > now - LIVE_WINDOW_MS) return "live";
  return "past";
}

export function topArtistsFromSpins(spins: DialSpin[], max = 3, hitField: "isLibraryHit" | "isArtistHit" = "isLibraryHit"): string[] {
  // Accumulate play counts so the result is ordered by frequency (most-played
  // artist first), matching the Recently Aired section's sort order.  Use
  // lower-case as the dedup key but preserve the first-encountered display form.
  const counts = new Map<string, { artist: string; count: number }>();
  for (const sp of spins) {
    // Defense in depth for old API responses and cached timeline data. Domain
    // values are radio metadata/ad slots, never artist names.
    const artist = sp.artist?.trim() ?? "";
    const domainLike = /^(?:https?:\/\/|[a-z0-9][a-z0-9.-]*\.(?:com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)(?:[/?#\s]|$))/i.test(artist);
    if (sp[hitField] && artist && !domainLike) {
      const key = artist.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { artist, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((v) => v.artist);
}

const MISSING_LIVE_ARTIST_VALUES = new Set([
  // Generic unknowns
  "unknown",
  "unknown artist",
  "artist unknown",
  "no artist",
  "unknown show",
  "unknown station",
  "unknown channel",
  "no metadata",
  "various artists",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "continuous",
  // Station programming / non-musical segments
  "commercial",
  "commercial break",
  "advertisement",
  "advertisements",
  "ads",
  "ad",
  "break",
  "station break",
  "news",
  "news break",
  "weather",
  "traffic",
  "sports",
  "id",
  "station id",
  "legal id",
  "liner",
  "station liner",
  "sweeper",
  "jingle",
  "bumper",
  "promo",
  "promotion",
  "spot",
  "intermission",
  "off air",
  "off-air",
  "sign off",
  "sign-off",
  "automation",
  // Filler / placeholder values that appear in the wild
  "music",
  "live",
  "now playing",
  "loading",
  "please wait",
  "tba",
  "tbd",
  "to be announced",
  "to be determined",
]);

/** Audio file-extension pattern — catches raw filenames used as artist fields. */
const AUDIO_FILENAME_RE = /\.\s*(mp3|wav|ogg|flac|aac|m4a|opus|wma|aiff?)\s*$/i;
/** At least one Unicode letter is required — rejects pure-punctuation / pure-digit strings. */
const HAS_LETTER_RE = /\p{L}/u;
/**
 * Combined "Artist - Title" ICY pattern.  Requires a space on both sides of the
 * dash so that legitimate hyphenated names like "Jean-Michel Jarre" are NOT split.
 * Captures everything before the first " - " as the artist and everything after as
 * the title.
 */
const ICY_COMBINED_RE = /^(.+?) - (.+)$/;

/**
 * If `artist` looks like a combined "Artist - Title" ICY field, return the split
 * parts; otherwise return null (no split needed).
 */
export function splitIcyCombinedField(
  artist: string,
): { artist: string; title: string } | null {
  const m = ICY_COMBINED_RE.exec(artist);
  if (!m) return null;
  return { artist: m[1].trim(), title: m[2].trim() };
}

function normalizeLiveArtist(value: string | null | undefined): string | null {
  const artist = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!artist) return null;
  // Reject strings that contain no letters (e.g. "---", "...", "12345", "- -")
  if (!HAS_LETTER_RE.test(artist)) return null;
  // Reject strings that look like audio filenames
  if (AUDIO_FILENAME_RE.test(artist)) return null;
  if (MISSING_LIVE_ARTIST_VALUES.has(artist.toLowerCase())) return null;
  return artist;
}

function normalizeLiveContext(value: string | null | undefined): string | null {
  const context = value?.replace(/\s+/g, " ").trim() ?? "";
  return context && !MISSING_LIVE_ARTIST_VALUES.has(context.toLowerCase()) ? context : null;
}

/** Max taste seeds per user — must match MAX_SEEDS in api-server taste-seeds.ts. */
export const MAX_TASTE_SEEDS = 50;

export function liveIdentityKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
}

type LiveArtistCandidate = LiveArtistSuggestion & { score: number; sourceIndex: number };

/**
 * Prefer live signals that are most likely to be useful to a new listener.
 * The values are intentionally explicit and additive: quality/tier establish
 * the source's floor, while human programming and usable schedule context
 * break ties within that floor.  The final source index keeps the result
 * stable when two stations are otherwise equivalent.
 */
function liveArtistScore(
  station: Station,
  context: { showName: string | null; djName: string | null },
): number {
  const stationTier =
    station.tier === "flagship" ? 420 :
    station.tier === "longtail" ? 0 : 80;
  const quality =
    station.qualityTier === "proven" ? 300 :
    station.qualityTier === "promising" ? 220 :
    station.qualityTier === "raw" ? 100 :
    station.qualityTier === "unscored" ? 30 : 10;
  const programming =
    station.automationClass === "human" ? 100 :
    station.automationClass === "automated" ? -90 : 0;
  const usableContext = (context.djName ? 65 : 0) + (context.showName ? 30 : 0);
  return stationTier + quality + programming + usableContext;
}

/**
 * Build the live-artist set used by no-library onboarding.
 *
 * This intentionally accepts assembled DialStations rather than schedule data:
 * an artist is suggested only when the station is live and has a current
 * now-playing track. Candidates are ranked before deduplication so a duplicate
 * artist is represented by the strongest live source, not whichever station
 * happened to be first in the station list.
 */
export function extractLiveArtistSuggestions(
  stations: DialStation[],
  max = 24,
): LiveArtistSuggestion[] {
  const candidates: LiveArtistCandidate[] = [];
  for (const [sourceIndex, dialStation] of stations.entries()) {
    if (!dialStation.isLive) continue;
    const show = dialStation.shows.find((candidate) => candidate.state === "live") ?? null;
    const track = dialStation.liveTrack ?? show?.currentTrack;
    const rawArtist = track?.artist ?? null;
    // Detect combined "Artist - Title" ICY metadata (spaces required around the dash).
    const split = rawArtist ? splitIcyCombinedField(rawArtist) : null;
    const artistValue = split ? split.artist : rawArtist;
    const artist = normalizeLiveArtist(artistValue);
    if (!artist) continue;
    // A station name/slug in the artist field is an ID or station filler, not
    // a useful taste seed. Keep this comparison accent/punctuation tolerant.
    const artistKey = liveIdentityKey(artist);
    if (
      artistKey &&
      [dialStation.station.name, dialStation.station.slug].some(
        (value) => liveIdentityKey(value) === artistKey,
      )
    ) continue;
    // Backfill title from the split when the track's own title field is empty.
    const resolvedTitle = normalizeLiveContext(track?.title) ?? (split ? normalizeLiveContext(split.title) : null);
    const showName = normalizeLiveContext(show?.showName);
    const djName = eligibleDjName(show?.djName, {
      artist,
      title: resolvedTitle,
      showTitle: showName,
      stationName: dialStation.station.name,
    });
    candidates.push({
      artist,
      stationSlug: dialStation.station.slug,
      stationName: normalizeLiveContext(dialStation.station.name),
      trackTitle: resolvedTitle,
      showName,
      djName,
      score: liveArtistScore(dialStation.station, { showName, djName }),
      sourceIndex,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex);
  const seen = new Set<string>();
  const suggestions: LiveArtistSuggestion[] = [];
  for (const candidate of candidates) {
    const key = liveIdentityKey(candidate.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    const { score: _score, sourceIndex: _sourceIndex, ...suggestion } = candidate;
    suggestions.push(suggestion);
    if (suggestions.length >= max) break;
  }
  return suggestions;
}

/**
 * Merge the bounded historical pool with current live suggestions.
 *
 * The API already ranks the historical list by frequency. We preserve that
 * order while building the identity map, then sort the final picker list by
 * Lore play count. A live candidate wins on display/context for a duplicate,
 * while its historical play count is retained for ranking and display.
 */
export function mergeOnboardingArtists(
  historical: StationsArtistFrequencyItem[],
  liveSuggestions: LiveArtistSuggestion[],
): OnboardingArtistSuggestion[] {
  const merged = new Map<string, OnboardingArtistSuggestion>();

  for (const item of historical) {
    const artist = normalizeLiveArtist(item.artist);
    const key = artist ? liveIdentityKey(artist) : "";
    if (!artist || !key || merged.has(key)) continue;
    merged.set(key, {
      artist,
      stationSlug: "",
      stationName: null,
      trackTitle: null,
      showName: null,
      djName: null,
      live: false,
      playCount: item.playCount,
    });
  }

  for (const suggestion of liveSuggestions) {
    const artist = suggestion.artist.replace(/\s+/g, " ").trim();
    const key = liveIdentityKey(artist);
    if (!artist || !key) continue;
    const existing = merged.get(key);
    merged.set(key, {
      ...(existing ?? {
        artist,
        stationSlug: suggestion.stationSlug,
        stationName: suggestion.stationName,
        trackTitle: suggestion.trackTitle,
        showName: suggestion.showName,
        djName: suggestion.djName,
      }),
      ...suggestion,
      artist,
      live: true,
      playCount: existing?.playCount ?? suggestion.playCount ?? null,
    });
  }

  return [...merged.values()].sort((a, b) => {
    // Live-only suggestions have no historical count, so they follow the
    // ranked Lore history while still receiving a deterministic alphabetical
    // order among themselves.
    const aCount = a.playCount ?? -1;
    const bCount = b.playCount ?? -1;
    return bCount - aCount ||
      a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }) ||
      a.artist.localeCompare(b.artist);
  });
}

// ---------------------------------------------------------------------------
// SSE spin-changed event type (mirrors SpinChangedEvent on the server)
// ---------------------------------------------------------------------------

interface SseSpinEntry {
  mbid: string | null;
  artistMbid: string | null;
  releaseGroupMbid: string | null;
  title: string;
  artist: string;
  playedAt: string;
  isFirstSpin: boolean;
  /** MusicBrainz first-release year (from the SSE payload); null when unknown. */
  releaseYear: number | null;
  /** MusicBrainz first-release date in partial-ISO form (from the SSE payload); null when unknown. */
  releaseDate: string | null;
  /** Server-computed hit flags — sent in the spin-changed SSE payload. */
  isLibraryHit: boolean;
  isArtistHit: boolean;
  /**
   * True while the entry came from a provisional `spin-raw` frame and is
   * still awaiting MusicBrainz resolution. `isLibraryHit` and `isArtistHit`
   * are always false for provisional entries — they cannot be confirmed
   * crossings until the resolved spin-changed frame arrives.
   */
  resolving?: boolean;
  /**
   * Pre-provisional state stashed on the first `spin-raw` frame so a terminal
   * `spin-raw-failed` can restore the last persisted spin. Chained provisional
   * frames keep the ORIGINAL stash — reverting to another unresolved row is
   * not meaningful.
   */
  revertTo?: Omit<SseSpinEntry, "resolving" | "revertTo">;
}

/**
 * The now-playing SSE stream carries three frame types sharing one message
 * channel: resolved `spin-changed` (type absent), provisional `spin-raw`
 * (pre-resolution), and terminal `spin-raw-failed` (never persisted).
 * Resolved frames are authoritative — they carry hit flags, MBID, and
 * release year. Guards the spin-changed upgrade path in the SSE handler.
 */
export function isResolvedSseSpinFrame(ev: { type?: string }): boolean {
  return ev.type !== "spin-raw" && ev.type !== "spin-raw-failed";
}

// ---------------------------------------------------------------------------
// Bounded pending — a loading flag with a settle deadline
// ---------------------------------------------------------------------------

/** How long Zone 1 may stay on its skeleton while crossings are pending. */
export const CROSSINGS_SETTLE_DEADLINE_MS = 25_000;

/**
 * How long a `computing: true` state may persist before the dial gives up and
 * shows a terminal "couldn't check right now" message. Well past the skeleton
 * deadline: this bounds the honest "still finding matches" degraded state.
 */
export const CROSSINGS_STALL_DEADLINE_MS = 120_000;

/**
 * Provenance of the current crossings result — what the dial may honestly say.
 *  - "loading":   pending, within the skeleton deadline (show skeleton)
 *  - "computing": pending past the skeleton deadline, server still computing
 *                 (show "still finding matches", never the empty nudge)
 *  - "stalled":   computing has persisted past CROSSINGS_STALL_DEADLINE_MS
 *  - "failed":    the server reported a crashed compute, or the query errored
 *  - "settled":   the server returned a genuine, non-computing result — the
 *                 ONLY phase in which the definitive empty state may render
 */
export type CrossingsPhase = "loading" | "computing" | "stalled" | "failed" | "settled";

/**
 * Pure derivation of the crossings result phase — exported for tests.
 * `withinSkeleton` / `withinStall` are the two bounded-pending signals
 * (`useBoundedPending` over the skeleton and stall deadlines respectively).
 * `hasResult` is true once an actual server response is in hand — "settled"
 * (the only phase allowed to claim "none of your artists played") requires
 * it, so a non-pending query that has never produced data (e.g. paused
 * offline, or the pre-fetch mount window) can never yield a false negative.
 */
export function deriveCrossingsPhase(args: {
  queryError: boolean;
  serverFailed: boolean;
  pending: boolean;
  hasResult: boolean;
  withinSkeleton: boolean;
  withinStall: boolean;
}): CrossingsPhase {
  if (args.queryError || args.serverFailed) return "failed";
  if (!args.pending) return args.hasResult ? "settled" : "loading";
  if (args.withinSkeleton) return "loading";
  return args.withinStall ? "computing" : "stalled";
}

/**
 * Returns `pending`, except that once it has been continuously true for
 * `deadlineMs` it flips to false and stays false until `pending` clears.
 *
 * Used to bound the Zone 1 crossings skeleton: a cold server compute or a
 * stuck poll may keep the crossings query pending for a long time, and the
 * dial must degrade to rendering whatever it has instead of holding a
 * skeleton forever. Resets whenever `pending` goes false so a later refetch
 * gets a fresh deadline.
 */
export function useBoundedPending(pending: boolean, deadlineMs: number): boolean {
  const [expired, setExpired] = useState(false);
  // Reset the expiry latch during render whenever `pending` clears, so a later
  // refetch gets a fresh deadline. Deriving this avoids a synchronous setState
  // in the effect below (which only arms the async timeout).
  const [prevPending, setPrevPending] = useState(pending);
  if (prevPending !== pending) {
    setPrevPending(pending);
    if (!pending && expired) setExpired(false);
  }
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setExpired(true), deadlineMs);
    return () => clearTimeout(id);
  }, [pending, deadlineMs]);
  return pending && !expired;
}

export type DialDisplayMode = "personal" | "blended";

/**
 * The seven mutually exclusive editorial station categories:
 *  - "ambient"    — Ambient & Sleep utility channels (sleep server mode)
 *  - "campus"     — college/university-operated stations
 *  - "specialist" — genre/era/format-focused channels (era-genre server mode)
 *  - "anchor"     — broadly-programmed flagship stations
 *  - "public"     — non-campus terrestrial/nonprofit community stations
 *  - "indie"      — web-native DJ/selector stations
 *  - "discovery"  — long-tail stations without a stronger editorial home
 *
 * Ambient and Specialist drive distinct server fetches; the other five are
 * applied as a client-side filter on the normal Lore station list using the
 * server-supplied single-value `stationCategories` array.
 */
export type DialStationCategory =
  | "ambient"
  | "campus"
  | "specialist"
  | "anchor"
  | "public"
  | "indie"
  | "discovery";

export function useDialData(
  displayMode: DialDisplayMode = "personal",
  opts: {
    sleepMode?: boolean;
    eraGenreMode?: boolean;
    /**
     * Additive multi-select station-category filter. Every checked category
     * contributes its stations to a union (deduplicated by station id):
     *  - Ambient = sleep server mode list
     *  - Specialist = era-genre server mode list
     *  - Anchor/Campus/Public/Indie/Discovery = client-side filter on the
     *    normal Lore list (no extra server fetch needed)
     * The empty set applies no filter (all stations). When omitted the legacy
     * single-mode sleepMode/eraGenreMode flags apply.
     */
    categories?: ReadonlySet<DialStationCategory>;
    /**
     * When true, skip the dial visibility filter (live / flagship / named
     * show) and return EVERY station from the list. The main SplitHome view
     * uses this so its alphabetical all-stations list includes off-air
     * stations without schedule metadata. Defaults to false — DialView and
     * every other consumer keep the curated filtering.
     */
    includeAllStations?: boolean;
    /**
     * When true, the unfiltered base station list is fetched (even when the
     * category filter would skip it) and returned as `scanStations` for the
     * Scan lens, which always shows every category regardless of the active
     * category filter. Defaults to false.
     */
    scanActive?: boolean;
    /**
     * Fetch personalized crossing scores. Defaults to true for the full Dial;
     * the minimal home view defers this expensive read so its live and archive
     * rails can become interactive first.
     */
    crossingsEnabled?: boolean;
    /**
     * Skip schedule, recent-spin, and artist-frequency enrichment for compact
     * surfaces that only need station identity plus the live pulse.
     */
    deferEnrichment?: boolean;
  } = {},
): {
  stations: DialStation[];
  /**
   * Raw curated station list, unfiltered by the category filter — the Scan
   * lens's data source. Empty unless `scanActive` (or the base list was
   * already being fetched for the filter).
   */
  scanStations: Station[];
  /**
   * Freshness-gated live now-playing track per station slug (REST poll + SSE
   * overrides), for the Scan lens. Only spins whose source observation is
   * inside the 60-minute live-pulse window appear — stale/off-air last spins
   * are excluded so Scan never presents an old track as live.
   */
  scanNowPlaying: Map<string, DialSpin>;
  spinsBySlug: Map<string, StationRecentSpin[]>;
  isLoading: boolean;
  isCoreLoading: boolean;
  liveLoading: boolean;
  crossingsLoading: boolean;
  hasLibrary: boolean;
  /** True when the user has entered at least one taste-seed artist. */
  hasSeeds: boolean;
  /** Current artists on live stations, for the no-library onboarding picker. */
  liveArtistSuggestions: LiveArtistSuggestion[];
  /** Lore-wide historical pool merged with current live artists. */
  onboardingArtists: OnboardingArtistSuggestion[];
  onboardingArtistsLoading: boolean;
  /** pickerId → overlap count from the server-computed full-library RG-widened endpoint. */
  overlapByPickerId: Map<number, number>;
  /** Normalised picker display name → pickerId — bridge for shows lacking a linked pickerId. */
  pickerNameToId: Map<string, number>;
  crossingSourceMode: DialDisplayMode;
  crossingError: boolean;
  /**
   * Provenance of the crossings result actually driving Zone 1. The definitive
   * "none of your artists played" empty state may only render when "settled".
   */
  crossingsPhase: CrossingsPhase;
  /** True when the station-list request has failed (network error or non-2xx response). */
  stationsError: boolean;
  /** Re-request the station list without navigating away. */
  refetchStations: () => void;
  /**
   * Reconcile a station's displayed now-playing track from an out-of-band
   * source (the station-landing fast lane). Writes into the same override
   * layer as the SSE spin-changed stream, so every dial surface inherits it.
   */
  applyNowPlayingOverride: (slug: string, entry: {
    mbid: string | null;
    artistMbid: string | null;
    title: string;
    artist: string;
    playedAt: string;
    releaseYear: number | null;
    releaseDate?: string | null;
  }) => void;
} {
  const today = todayStr();
  const yesterday = yesterdayStr();

  // ── SSE override: instant now-playing from the server's spin-changed stream ─
  // The shared spin-stream subscriber (one EventSource per tab) delivers three
  // frame types. We handle all of them to show tracks the moment they appear:
  //
  //   spin-raw          — provisional fast path: the metadata changed but MB
  //                       resolution has not completed yet. Show immediately
  //                       with resolving:true; isLibraryHit/isArtistHit stay
  //                       false (cannot be confirmed crossings yet).
  //   spin-raw-failed   — terminal failure: the provisional track never
  //                       persisted. Revert to the stashed pre-provisional row.
  //   spin-changed      — resolved, persisted spin. Clears the resolving flag
  //                       and sets accurate hit flags from the server.
  //
  // The override map is keyed by station slug; each entry's resolving flag
  // drives the subtle "resolving" visual cue on the Dial feed row.
  const [sseOverrides, setSseOverrides] = useState<Map<string, SseSpinEntry>>(
    () => new Map(),
  );
  useEffect(() => {
    return subscribeSpinStream((ev) => {
      // ── spin-raw-failed: revert the provisional row ──────────────────────
      if (ev.type === "spin-raw-failed") {
        setSseOverrides((prev) => {
          const existing = prev.get(ev.stationSlug);
          // Only revert when the current entry is the matching provisional row.
          if (
            !existing?.resolving ||
            existing.artist !== ev.rawArtist ||
            existing.title !== ev.rawTitle
          ) {
            return prev;
          }
          const next = new Map(prev);
          if (existing.revertTo) {
            next.set(ev.stationSlug, { ...existing.revertTo });
          } else {
            next.delete(ev.stationSlug);
          }
          return next;
        });
        return;
      }

      // ── spin-raw: provisional fast path — show immediately ────────────────
      if (ev.provisional === true) {
        setSseOverrides((prev) => {
          const existing = prev.get(ev.stationSlug);
          // Never downgrade a resolved row back to provisional for the same track.
          if (
            existing &&
            !existing.resolving &&
            existing.mbid != null &&
            existing.artist === ev.rawArtist &&
            existing.title === ev.rawTitle
          ) {
            return prev;
          }
          const next = new Map(prev);
          const observedAt = ev.observedAt ?? new Date().toISOString();
          // Stash the pre-provisional state so spin-raw-failed can revert.
          // Chained provisional frames keep the ORIGINAL stash.
          const revertTo: SseSpinEntry["revertTo"] =
            existing?.revertTo ??
            (existing
              ? {
                  mbid: existing.mbid,
                  artistMbid: existing.artistMbid,
                  releaseGroupMbid: existing.releaseGroupMbid,
                  title: existing.title,
                  artist: existing.artist,
                  playedAt: existing.playedAt,
                  releaseYear: existing.releaseYear,
                  releaseDate: existing.releaseDate,
                  isFirstSpin: existing.isFirstSpin,
                  isLibraryHit: existing.isLibraryHit,
                  isArtistHit: existing.isArtistHit,
                }
              : undefined);
          next.set(ev.stationSlug, {
            mbid: null,
            artistMbid: ev.artistMbid ?? null,
            releaseGroupMbid: null,
            title: ev.rawTitle ?? "",
            artist: ev.rawArtist ?? "",
            playedAt: observedAt,
            releaseYear: ev.releaseYear ?? null,
            releaseDate: ev.releaseDate ?? null,
            isFirstSpin: ev.isFirstSpin ?? false,
            // Hit flags are unknown until resolution completes.
            isLibraryHit: false,
            isArtistHit: false,
            resolving: true,
            revertTo,
          });
          return next;
        });
        return;
      }

      // ── spin-changed: resolved, persisted spin ────────────────────────────
      if (!isResolvedSseSpinFrame(ev)) return;
      setSseOverrides((prev) => {
        const next = new Map(prev);
        next.set(ev.stationSlug, {
          mbid: ev.mbid ?? null,
          artistMbid: ev.artistMbid ?? null,
          releaseGroupMbid: ev.releaseGroupMbid ?? null,
          title: ev.rawTitle ?? "",
          artist: ev.rawArtist ?? "",
          playedAt: ev.observedAt ?? new Date().toISOString(),
          releaseYear: ev.releaseYear ?? null,
          releaseDate: ev.releaseDate ?? null,
          isFirstSpin: ev.isFirstSpin ?? false,
          // Hit flags computed server-side per listener at spin-write time.
          isLibraryHit: ev.isLibraryHit ?? false,
          isArtistHit: ev.isArtistHit ?? false,
          // Clear the resolving flag now that the spin is persisted.
          resolving: false,
        });
        return next;
      });
    });
  }, []);

  // Fast-lane reconciliation: a station-landing fast-lane result that names a
  // different track than the display writes into the same override map the
  // SSE stream uses, so the correction propagates to every dial surface.
  // Hit flags aren't part of the fast-lane payload — keep the existing
  // entry's flags when the track is unchanged, otherwise reset to false
  // (the next REST poll / SSE push carries the authoritative flags).
  const applyNowPlayingOverride = useCallback((slug: string, entry: {
    mbid: string | null;
    artistMbid: string | null;
    releaseGroupMbid?: string | null;
    title: string;
    artist: string;
    playedAt: string;
    releaseYear: number | null;
    releaseDate?: string | null;
  }) => {
    setSseOverrides((prev) => {
      const next = new Map(prev);
      const existing = prev.get(slug);
      const sameTrack = existing != null && existing.mbid != null && existing.mbid === entry.mbid;
      next.set(slug, {
        ...entry,
        releaseGroupMbid: entry.releaseGroupMbid
          ?? (sameTrack ? existing.releaseGroupMbid : null),
        releaseDate: entry.releaseDate ?? null,
        isFirstSpin: sameTrack ? existing.isFirstSpin : false,
        isLibraryHit: sameTrack ? existing.isLibraryHit : false,
        isArtistHit: sameTrack ? existing.isArtistHit : false,
      });
      return next;
    });
  }, []);

  // ── fetch stations ──────────────────────────────────────────────────────
  // Sleep Radio swaps the station source; the query key includes the params,
  // so entering/leaving the mode refetches the right list automatically while
  // the default (no-params) cache stays warm for the normal dial.
  const sleepMode = opts.sleepMode === true;
  const eraGenreMode = opts.eraGenreMode === true;
  // Front-door category filter: the station-category menu can additively layer
  // Genre (era-genre) and Ambient (sleep) stations on top of the normal Lore
  // list. When `categories` is provided it drives fetching; the legacy single
  // `sleepMode`/`eraGenreMode` flags stay supported for the hidden gesture modes.
  const categories = opts.categories;
  const includeAllStations = opts.includeAllStations === true;
  // Scan lens: needs the full curated list (and the global now-playing pulse)
  // even when the category filter would skip the base list entirely.
  const scanActive = opts.scanActive === true;
  // Additive multi-select taxonomy: any subset of categories may be checked.
  //  - "ambient"    → sleep server mode list
  //  - "specialist" → era-genre server mode list
  //  - anchor/campus/public/indie/discovery → normal Lore list + client-side
  //    filter on the server-supplied single-value `stationCategories` array.
  // All checked categories' stations are unioned and deduplicated by id.
  const wantAmbient = categories ? categories.has("ambient") : sleepMode;
  const wantSpecialist = categories ? categories.has("specialist") : eraGenreMode;
  // Metadata categories filter the fetched Lore list client-side; no extra
  // server fetch is needed for them.
  const metaCategories: readonly DialStationCategory[] = categories
    ? [...categories].filter((c) => c !== "ambient" && c !== "specialist")
    : [];

  // Hidden browse modes swap the station source. Sleep takes precedence if both
  // flags somehow arrive true (the modes are mutually exclusive upstream).
  const modeParam = sleepMode
    ? ({ mode: "sleep" } as const)
    : eraGenreMode
    ? ({ mode: "era-genre" } as const)
    : undefined;
  // Base list. Legacy single-mode use (no categories) fetches the mode list
  // directly. In the category-driven path the base list is the normal Lore
  // list, needed whenever no filter is active or any metadata category is
  // checked; ambient/specialist pools are separate union fetches below.
  const baseParam = categories ? undefined : modeParam;
  const wantNormalList = !categories || categories.size === 0 || metaCategories.length > 0;
  const { data: stationsData, isLoading: stationsLoading, isError: stationsError, refetch: refetchStations } = useListStations(
    baseParam,
    { query: { queryKey: getListStationsQueryKey(baseParam), enabled: wantNormalList || scanActive } },
  );
  // Union pools: fetched when their category is explicitly checked — and
  // whenever the Scan lens is active, since Scan covers every category
  // (ambient/specialist stations only exist in these pools; they are
  // intentionally hidden from the default list).
  const { data: ambientData, isLoading: ambientLoading, isError: ambientError, refetch: refetchAmbient } = useListStations(
    { mode: "sleep" } as const,
    { query: { queryKey: getListStationsQueryKey({ mode: "sleep" }), enabled: (categories != null && wantAmbient) || scanActive } },
  );
  const { data: specialistData, isLoading: specialistLoading, isError: specialistError, refetch: refetchSpecialist } = useListStations(
    { mode: "era-genre" } as const,
    { query: { queryKey: getListStationsQueryKey({ mode: "era-genre" }), enabled: (categories != null && wantSpecialist) || scanActive } },
  );

  // ── live pulse (30s polling) ─────────────────────────────────────────────
  // While Scan is active, poll the inclusive variant so stations that only
  // exist in the sleep / era-genre mode pools get now-playing rows too. The
  // payload is a superset of the default, and every downstream consumer looks
  // spins up per-slug, so the dial feed is unaffected by the switch.
  const npParams = scanActive
    ? ({ includeModePools: true } as const)
    : undefined;
  const { data: liveData, isLoading: liveLoading } = useListStationsNowPlaying(
    npParams,
    {
      query: {
        queryKey: getListStationsNowPlayingQueryKey(npParams),
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
      },
    },
  );

  // ── schedule runs (today + yesterday for rolling 24h window) ────────────
  const { data: scheduleData, isLoading: schedLoading } = useGetStationsSchedule(
    { date: today },
    {
      query: {
        queryKey: getGetStationsScheduleQueryKey({ date: today }),
        enabled: !opts.deferEnrichment,
        staleTime: 60_000,
        refetchInterval: 2 * 60_000,
      },
    },
  );
  // Yesterday's runs — overnight shows that started before midnight are absent
  // from today's calendar-day slice; fetching yesterday closes the 24h gap.
  const { data: scheduleDataYesterday } = useGetStationsSchedule(
    { date: yesterday },
    {
      query: {
        queryKey: getGetStationsScheduleQueryKey({ date: yesterday }),
        enabled: !opts.deferEnrichment,
        // Yesterday's data is stable; refresh infrequently.
        staleTime: 5 * 60_000,
        refetchInterval: 10 * 60_000,
      },
    },
  );

  // ── recent spins (today only — station-level crossings come from the server) ─
  // Yesterday's spins are no longer fetched: station ranking uses
  // GET /api/me/crossings (a true NOW() − 24h server-side query), so the
  // client only needs today's spins for per-show chip display.
  const { data: spinsData, isLoading: spinsLoading } = useGetStationsRecentSpins(
    { date: today },
    {
      query: {
        queryKey: getGetStationsRecentSpinsQueryKey({ date: today }),
        enabled: !opts.deferEnrichment,
        staleTime: 60_000,
        refetchInterval: 2 * 60_000,
      },
    },
  );

  // Bounded, all-time Lore history for no-library onboarding. This is public
  // data and intentionally independent of the listener's library/session.
  const { data: artistFrequencyData, isLoading: artistFrequencyLoading } =
    useGetStationsArtistFrequency({
      query: {
        queryKey: getGetStationsArtistFrequencyQueryKey(),
        enabled: !opts.deferEnrichment,
        staleTime: 10 * 60_000,
        refetchInterval: 10 * 60_000,
      },
    });

  // ── server-computed crossing scores (rolling 24h, full spin history) ────────
  // These replace the client-side crossing reduction at the station level so
  // ranking is consistent across clients and not bounded by the fetch page cap.
  // The server may return `computing: true` on a cold cache (background compute
  // still running); the hook polls fast in that state, and we keep the Zone 1
  // skeleton up — but only up to a bounded deadline, so the dial can never be
  // held on a skeleton indefinitely by a stuck compute.
  const {
    data: crossingsResult,
    isLoading: crossingsQueryLoading,
    isError: crossingsQueryError,
  } = useMyDialCrossings(today, opts.crossingsEnabled ?? true);
  const serverCrossings = crossingsResult?.items;
  const crossingsPending = crossingsQueryLoading || crossingsResult?.computing === true;
  const crossingsLoading = useBoundedPending(crossingsPending, CROSSINGS_SETTLE_DEADLINE_MS);
  // Second, much longer bound on the same pending signal: past it, a still-
  // computing server is treated as stalled and the dial shows terminal
  // "couldn't check" copy instead of "still finding matches" forever.
  const withinStallBound = useBoundedPending(crossingsPending, CROSSINGS_STALL_DEADLINE_MS);
  // Result provenance: the definitive Zone 1 empty state may only render in
  // the "settled" phase — a genuine non-computing, non-failed server result.
  const crossingsPhase = deriveCrossingsPhase({
    queryError: crossingsQueryError,
    serverFailed: crossingsResult?.failed === true,
    pending: crossingsPending,
    hasResult: crossingsResult != null,
    withinSkeleton: crossingsLoading,
    withinStall: withinStallBound,
  });
  const {
    data: blendedCrossings,
    isLoading: _blendedLoading,
    isError: blendedError,
  } = useMyBlendedCrossings(displayMode === "blended");
  const selectedCrossings: DialCrossing[] | undefined =
    displayMode === "blended"
      ? blendedCrossings ?? (blendedError ? serverCrossings : undefined)
      : serverCrossings;
  const crossingSourceMode: DialDisplayMode =
    displayMode === "blended" && blendedCrossings == null ? "personal" : displayMode;
  const selectedCrossingsLoading =
    displayMode === "blended" ? blendedCrossings == null && !blendedError : crossingsLoading;
  // In blended mode a loaded blend is settled; on blend error we fall back to
  // the personal crossings, so their phase governs what Zone 1 may claim.
  const selectedCrossingsPhase: CrossingsPhase =
    displayMode === "blended"
      ? blendedCrossings != null
        ? "settled"
        : blendedError
          ? crossingsPhase
          : "loading"
      : crossingsPhase;

  const serverCrossingsBySlug = useMemo(() => {
    const m = new Map<string, {
      crossings: number;
      artistCrossings: number;
      firstPlayCrossings: number;
      weekCrossings: number;
      weekArtistCrossings: number;
      weekFirstPlayCrossings: number;
      monthCrossings: number;
      monthArtistCrossings: number;
      monthFirstPlayCrossings: number;
      lifetimeCrossings: number;
      lifetimeArtistCrossings: number;
      lifetimeFirstPlayCrossings: number;
      topArtistNames: string[];
      topArtistNames24h: string[];
      topArtistNames7d: string[];
      topArtistNamesLifetime: string[];
    }>();
    for (const cx of selectedCrossings ?? []) {
      m.set(cx.stationSlug, {
        crossings: cx.crossings,
        artistCrossings: cx.artistCrossings,
        firstPlayCrossings: cx.firstPlayCrossings ?? 0,
        weekCrossings: cx.weekCrossings ?? 0,
        weekArtistCrossings: cx.weekArtistCrossings ?? 0,
        weekFirstPlayCrossings: cx.weekFirstPlayCrossings ?? 0,
        monthCrossings: cx.monthCrossings ?? 0,
        monthArtistCrossings: cx.monthArtistCrossings ?? 0,
        monthFirstPlayCrossings: cx.monthFirstPlayCrossings ?? 0,
        lifetimeCrossings: cx.lifetimeCrossings,
        lifetimeArtistCrossings: cx.lifetimeArtistCrossings,
        lifetimeFirstPlayCrossings: cx.lifetimeFirstPlayCrossings ?? 0,
        topArtistNames: cx.topArtistNames ?? [],
        topArtistNames24h: cx.topArtistNames24h ?? [],
        topArtistNames7d: cx.topArtistNames7d ?? [],
        topArtistNamesLifetime: cx.topArtistNamesLifetime ?? [],
      });
    }
    return m;
  }, [selectedCrossings]);

  // ── hasLibrary flag — from the picker-names endpoint (no MBID download) ─────
  // GET /api/me/picker-names returns both the picker display names and a
  // hasLibrary boolean so the client never has to download the full MBID list.
  const { data: pickerNamesData } = useMyPickerNames();

  // ── picker overlap — full library, RG-widened, server-computed ─────────────
  // Replaces the 60-MBID sampled batch lookup.  Keyed by pickerId (integer) so
  // the sort is identity-safe even when two pickers share a display name.
  const { data: pickerOverlapItems = [] } = useMyPickerOverlap();

  const overlapByPickerId = useMemo(() => {
    const m = new Map<number, number>();
    for (const item of pickerOverlapItems) m.set(item.pickerId, item.overlapCount);
    return m;
  }, [pickerOverlapItems]);

  // Normalised picker name → pickerId bridge: used when a live show has a djName
  // but no linked pickerId yet (e.g. show not yet attached to a picker row).
  const pickerNameToId = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of pickerOverlapItems) m.set(normalizeDjName(item.pickerName), item.pickerId);
    return m;
  }, [pickerOverlapItems]);

  // ── index by station slug ─────────────────────────────────────────────────
  // liveBySlug applies the LIVE_PULSE_WINDOW_MS freshness gate (see module
  // scope) to the source playedAt of each station's latest spin.
  const liveBySlug = useMemo(() => {
    const m = new Map<string, boolean>();
    // Current wall-clock time is intentional here: this memo recomputes on
    // each 30s live poll and stamps recency relative to "now". There is no
    // stable input that encodes the present instant.
    // eslint-disable-next-line react-hooks/purity -- render-time clock read is the intended freshness check, recomputed per poll
    const now = Date.now();
    for (const item of liveData?.items ?? []) {
      const np = item.nowPlaying;
      const playedAt = np != null ? (np as { playedAt?: string }).playedAt : undefined;
      const isRecent =
        np != null &&
        playedAt != null &&
        now - new Date(playedAt).getTime() <= LIVE_PULSE_WINDOW_MS;
      m.set(item.slug, isRecent);
    }
    return m;
  }, [liveData]);

  // ── live now-playing track per station (for live block currentTrack) ───────
  // REST poll data is the baseline; SSE overrides (fired the moment a spin is
  // persisted) are merged on top so live chips update instantly instead of
  // waiting up to 30s for the next poll cycle.
  //
  // isLibraryHit / isArtistHit are now server-computed per listener and
  // returned in both the now-playing REST response and the SSE event payload.
  // No client-side library set membership is needed here.
  // REST parse with the SOURCE observation time preserved. Entries without a
  // parseable playedAt are dropped: liveBySlug already marks them not-live
  // (so no existing consumer loses a row), and the Scan lens must never
  // present an observation whose freshness can't be vouched for.
  const restNowPlaying = useMemo((): Map<string, DialSpin> => {
    const m = new Map<string, DialSpin>();

    for (const item of liveData?.items ?? []) {
      const np = item.nowPlaying;
      if (!np) continue;
      const title = (np as { title?: string | null }).title ?? (np as { rawTitle?: string | null }).rawTitle ?? "";
      const artist = (np as { artist?: string | null }).artist ?? (np as { rawArtist?: string | null }).rawArtist ?? "";
      if (!title && !artist) continue;
      const mbid = (np as { mbid?: string | null }).mbid ?? null;
      const artistMbid = (np as { artistMbid?: string | null }).artistMbid ?? null;
      // releaseYear/releaseDate live on the resolved recording sub-object.
      const recording = (np as { recording?: { releaseGroupMbid?: string | null; releaseYear?: number | null; releaseDate?: string | null } | null }).recording;
      const releaseGroupMbid =
        recording?.releaseGroupMbid
        ?? (np as { releaseGroupMbid?: string | null }).releaseGroupMbid
        ?? null;
      const releaseYear = recording?.releaseYear ?? null;
      const releaseDate = recording?.releaseDate ?? null;
      const isFirstSpin = (np as { isFirstSpin?: boolean }).isFirstSpin ?? false;
      const sourcePlayedAt = (np as { playedAt?: string | null }).playedAt ?? null;
      if (!sourcePlayedAt || Number.isNaN(new Date(sourcePlayedAt).getTime())) continue;
      // Server-computed freshness gate: a stale observation is never counted
      // as a confirmed live crossing — hit flags are downgraded here, at the
      // single point where the live snapshot becomes currentTrack/liveTrack,
      // so every crossing presentation (grammar, front door, lanes) inherits
      // the rule. Absent freshness = unknown ⇒ behaves exactly as today.
      const gated = gateLiveHitFlags(
        np as { freshness?: string | null; isLibraryHit?: boolean; isArtistHit?: boolean },
      );
      m.set(item.slug, {
        mbid,
        artistMbid,
        releaseGroupMbid,
        title,
        artist,
        playedAt: sourcePlayedAt,
        sourcePlayedAt,
        isLibraryHit: gated.isLibraryHit,
        isArtistHit: gated.isArtistHit,
        isFirstSpin,
        releaseYear,
        releaseDate,
        // Live rows: playedAt is ~now, so spinAgeTier's default (now) applies.
        ageTier: spinAgeTier(isFirstSpin, releaseYear, releaseDate),
      });
    }
    return m;
  }, [liveData]);

  const nowPlayingBySlug = useMemo((): Map<string, DialSpin> => {
    const m = new Map<string, DialSpin>();

    // REST rows are stamped ~now for live-chip display (pre-existing display
    // semantics). Preserve the honest source timestamp separately so surfaces
    // that rank newly started tracks can compare station observations.
    for (const [slug, spin] of restNowPlaying) {
      m.set(slug, {
        ...spin,
        playedAt: new Date().toISOString(),
        sourcePlayedAt: spin.playedAt,
      });
    }
    // SSE overrides: more recent than the REST poll, applied last so the Dial
    // chip reflects the current on-air track the moment it is logged.
    // Hit flags are included in the SSE payload (computed server-side at
    // spin-write time) and stored in the SseSpinEntry, so no recomputation needed.
    for (const [slug, entry] of sseOverrides) {
      m.set(slug, {
        mbid: entry.mbid,
        artistMbid: entry.artistMbid,
        title: entry.title,
        artist: entry.artist,
        playedAt: entry.playedAt,
        sourcePlayedAt: entry.playedAt,
        isLibraryHit: entry.isLibraryHit,
        isArtistHit: entry.isArtistHit,
        isFirstSpin: entry.isFirstSpin,
        releaseYear: entry.releaseYear,
        releaseDate: entry.releaseDate,
        ageTier: spinAgeTier(entry.isFirstSpin, entry.releaseYear, entry.releaseDate, entry.playedAt),
        // Propagate the resolving flag so FrontDoorRow can show the visual cue.
        ...(entry.resolving ? { resolving: true } : {}),
      });
    }
    return m;
  }, [restNowPlaying, sseOverrides]);

  // Scan lens: the freshness-gated subset of now-playing data. Only spins
  // whose SOURCE observation is inside the 60-minute live-pulse window appear,
  // so a stale/off-air last spin is never rotated in as "live".
  const scanNowPlaying = useMemo((): Map<string, DialSpin> => {
    const sseFinal = new Map<string, DialSpin>();
    for (const slug of sseOverrides.keys()) {
      const spin = nowPlayingBySlug.get(slug);
      if (spin) sseFinal.set(slug, spin);
    }
    // eslint-disable-next-line react-hooks/purity -- freshness is defined relative to "now", recomputed on each poll/SSE event
    return buildScanNowPlaying(restNowPlaying, sseFinal, Date.now());
  }, [restNowPlaying, sseOverrides, nowPlayingBySlug]);

  const runsBySlug = useMemo(() => {
    const m = new Map<string, StationScheduleRun[]>();
    // Yesterday first so today's runs sort after them chronologically when merged.
    for (const item of scheduleDataYesterday?.items ?? []) {
      m.set(item.stationSlug, [...item.runs]);
    }
    for (const item of scheduleData?.items ?? []) {
      const existing = m.get(item.stationSlug);
      if (existing) {
        existing.push(...item.runs);
      } else {
        m.set(item.stationSlug, [...item.runs]);
      }
    }
    return m;
  }, [scheduleData, scheduleDataYesterday]);

  const spinsBySlug = useMemo(() => {
    const m = new Map<string, StationRecentSpin[]>();
    for (const item of spinsData?.items ?? []) {
      m.set(item.stationSlug, [...item.spins]);
    }
    return m;
  }, [spinsData]);

  // pins are managed externally by DialView; not needed for data assembly

  // Listener-pinned personal stations (Station Finder). Device-local, adapted
  // to the Station shape so they flow through the same enrichment pipeline as
  // curated stations below.
  const { addedStations } = useAddedStations();
  const personalStations = useMemo(
    () => addedStations.map(addedStationToStation),
    [addedStations],
  );

  // ── assemble enriched stations ────────────────────────────────────────────
  const stations = useMemo((): DialStation[] => {
    // Additive multi-select taxonomy: union the normal Lore list with the
    // ambient (sleep) and specialist (era-genre) mode pools, deduplicated by
    // station id. Mode-pool membership is tracked independently of the dedup
    // so a station present in BOTH the normal list and a checked mode pool
    // still counts as a pool member (renders always-live and survives the
    // metadata filter even without a matching stationCategories label).
    // In the legacy single-mode path (no categories), only the base list is
    // present.
    const alwaysLiveSlugs = new Set<string>();
    // `mode=era-genre` returns each station's normal editorial label (ambient,
    // discovery, etc.). Once the listener deliberately selects Specialist,
    // that mode-pool membership must become the Feed's primary grouping so the
    // complete pool reaches its subcategory cards rather than leaking into
    // several unrelated top-level cards. This is a display-only clone below;
    // the raw API response and default Dial semantics remain untouched.
    const selectedSpecialistSlugs = new Set<string>();
    const bySlugRaw = new Map<string, Station>();
    const seenIds = new Set<number | string>();
    const addAll = (
      list: Station[] | undefined,
      poolIsAlwaysLive: boolean,
      isSpecialistPool = false,
    ) => {
      for (const s of list ?? []) {
        // Record pool membership BEFORE the dedup check: a duplicate from the
        // normal list must still be treated as a mode-pool station.
        if (poolIsAlwaysLive) alwaysLiveSlugs.add(s.slug);
        if (isSpecialistPool) selectedSpecialistSlugs.add(s.slug);
        // Dedupe by station id; tolerate id-less fixtures by falling back to
        // the slug (both are unique per station).
        const key: number | string = s.id ?? s.slug;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        bySlugRaw.set(s.slug, s);
      }
    };
    if (categories) {
      // Only requested sources contribute: the normal list is skipped when no
      // metadata category is checked and the filter is non-empty (a disabled
      // TanStack Query observer can retain cached data, so gate on
      // wantNormalList rather than on stationsData being undefined).
      if (wantNormalList) addAll(stationsData?.stations, false);
      // Mode pools join the union only when their category is checked; every
      // station they contribute renders as always-live.
      if (wantAmbient) addAll(ambientData?.stations, true);
      if (wantSpecialist) addAll(specialistData?.stations, true, true);
    } else {
      addAll(stationsData?.stations, false);
    }
    // A warm React Query cache may retain a mode-pool list after its mode was
    // unchecked. Keep those known pool slugs out of the unclassified fallback
    // until their own mode is selected again; otherwise a base-list duplicate
    // would leak an inactive Sleep/Specialist station into a metadata view.
    const inactiveModePoolSlugs = new Set<string>();
    if (!wantAmbient) {
      for (const station of ambientData?.stations ?? []) inactiveModePoolSlugs.add(station.slug);
    }
    if (!wantSpecialist) {
      for (const station of specialistData?.stations ?? []) inactiveModePoolSlugs.add(station.slug);
    }

    // Client-side metadata filter: when anchor/campus/public/indie/discovery
    // categories are checked, restrict tagged normal-list stations to a
    // checked label. Untagged stations are deliberately preserved as the
    // compact Feed's direct "Other stations" fallback rather than vanishing
    // simply because they have not been editorially classified yet. Mode-pool
    // stations (ambient/specialist) already passed by virtue of their category
    // being checked, so they always survive the filter.
    const filteredBySlug = metaCategories.length > 0
      ? new Map(
          [...bySlugRaw].filter(([slug, s]) => {
            if (alwaysLiveSlugs.has(slug)) return true;
            const cats = (s.stationCategories ?? []) as string[];
            return (cats.length === 0 && !inactiveModePoolSlugs.has(slug))
              || metaCategories.some((c) => cats.includes(c));
          }),
        )
      : bySlugRaw;
    // Personal (listener-pinned) stations join the raw pool here so they flow
    // through the same enrichment below. A listener-pinned station with no
    // editorial tag remains visible in the direct fallback; tagged personal
    // stations follow the selected category set. A personal station whose
    // name matches a curated station is dropped — the curated row wins (the
    // Finder already blocks adding catalog stations via inLoreCatalog).
    const curatedNames = new Set(
      [...bySlugRaw.values()].map((s) => s.name.trim().toLowerCase()),
    );
    const personalRaw = personalStations.filter((s) => {
      if (curatedNames.has(s.name.trim().toLowerCase())) return false;
      if (!categories || categories.size === 0) return true;
      const cats = (s.stationCategories ?? []) as string[];
      if (cats.length === 0) return true;
      for (const c of categories) if (cats.includes(c)) return true;
      return false;
    });
    const personalSlugs = new Set(personalRaw.map((s) => s.slug));
    const curatedRaw = [...filteredBySlug.values()].map((station) =>
      selectedSpecialistSlugs.has(station.slug)
        ? { ...station, stationCategories: ["specialist"] }
        : station,
    );
    const raw = [...curatedRaw, ...personalRaw];
    // Rolling 24-hour cutoff for crossings. We fetch both today's and
    // yesterday's data so that overnight shows are present, but only spins
    // within the past 24 hours count toward crossings — spins from earlier
    // yesterday (e.g. 6 am when it is now 9 am) are excluded. The memo
    // recomputes on each spin/schedule poll, stamping the window from "now".
    // eslint-disable-next-line react-hooks/purity -- rolling 24h cutoff is defined relative to the present instant, recomputed per data poll
    const window24hCutoffMs = Date.now() - 24 * 60 * 60 * 1000;

    return raw.map((station) => {
      // Sleep Radio: sleep stations are 24/7 ambient streams that are hidden
      // from the now-playing pollers, so the live pulse never marks them
      // recent. Treat every station in the sleep list as tunable ("live") so
      // the dial renders them through the ordinary live pipeline.
      const isLive = sleepMode || eraGenreMode || alwaysLiveSlugs.has(station.slug)
        ? true
        : (liveBySlug.get(station.slug) ?? false);
      const rawRuns = runsBySlug.get(station.slug) ?? [];
      const rawSpins = spinsBySlug.get(station.slug) ?? [];

      // Sort runs oldest-first for the timeline
      const sortedRuns = [...rawRuns].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      );

      // Sort spins oldest-first
      const sortedSpins = [...rawSpins].sort(
        (a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime(),
      );

      // Build enriched shows by associating spins with their run window
      const shows: DialShow[] = sortedRuns.map((run) => {
        const state = showState(run, isLive);
        const startMs = new Date(run.startedAt).getTime();
        const endMs = new Date(run.endedAt).getTime();

        // Assign spins that fall within this run's time window.
        // All matching spins are kept for display (chip timeline, currentTrack);
        // only spins inside the rolling 24h window count toward crossings.
        const runSpins: DialSpin[] = sortedSpins
          .filter((sp) => {
            const t = new Date(sp.playedAt).getTime();
            return t >= startMs - 60_000 && t <= endMs + 60_000;
          })
          .map((sp) => {
            const isFirstSpin = sp.isFirstSpin ?? false;
            const releaseYear = sp.releaseYear ?? null;
            const releaseDate =
              (sp as { releaseDate?: string | null }).releaseDate ?? null;
            return {
              mbid: sp.mbid,
              artistMbid: sp.artistMbid ?? null,
              releaseGroupMbid: sp.releaseGroupMbid ?? null,
              title: sp.title,
              artist: sp.artist,
              playedAt: sp.playedAt,
              // isLibraryHit / isArtistHit computed server-side per listener;
              // returned in the recent-spins response and consumed directly here.
              isLibraryHit: sp.isLibraryHit,
              isArtistHit: sp.isArtistHit,
              isFirstSpin,
              releaseYear,
              releaseDate,
              ageTier: spinAgeTier(isFirstSpin, releaseYear, releaseDate, sp.playedAt),
            };
          });

        // Count only spins within the rolling 24h window so that a show that
        // aired yesterday morning doesn't inflate today's crossing count.
        const recentSpins = runSpins.filter(
          (sp) => new Date(sp.playedAt).getTime() >= window24hCutoffMs,
        );
        const crossings = recentSpins.filter((sp) => sp.isLibraryHit).length;
        // Artist crossings: spins by library artists where the exact track wasn't in library.
        const artistCrossings = recentSpins.filter((sp) => sp.isArtistHit).length;
        const topArtists = topArtistsFromSpins(runSpins, 3, "isLibraryHit");
        const topArtistNames = topArtistsFromSpins(runSpins, 3, "isArtistHit");
        // Prefer the live now-playing API track; fall back to most recent spin in window
        const currentTrack =
          state === "live"
            ? (nowPlayingBySlug.get(station.slug) ?? (runSpins.length > 0 ? runSpins[runSpins.length - 1] : null))
            : null;
        // Use eligibleDjNames so a single DJ provided only via djNames (djName=null)
        // is still credited, and two distinct DJs collapse to null (ambiguous).
        const usableDjList = eligibleDjNames(
          { name: run.show?.name ?? "", djName: run.show?.djName ?? undefined, djNames: run.show?.djNames ?? undefined },
          { artist: currentTrack?.artist, title: currentTrack?.title, showTitle: run.show?.name, stationName: station.name },
        );
        const usableDjName = usableDjList.length === 1 ? usableDjList[0] : null;
        // isPickerShow: derived from pickerId presence on the show row, but
        // never keep a linked picker alive for rejected live attribution or
        // for ambiguous multi-DJ shows (no single selector to credit).
        const pickerId = run.show?.pickerId ?? null;
        const isPickerShow = pickerId != null && usableDjList.length === 1;

        return {
          runId: run.runId,
          showName: run.show?.name ?? "Unknown show",
          djName: usableDjName,
          // Pass through the multi-DJ list when the source provides it so the
          // attribution cascade can suppress individual DJ names when ambiguous.
          djNames: run.show?.djNames ?? undefined,
          pickerId,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          ianaTimezone: run.ianaTimezone ?? station.ianaTimezone ?? null,
          state,
          spins: runSpins,
          crossings,
          artistCrossings,
          topArtists,
          topArtistNames,
          currentTrack,
          isPickerShow,
        };
      });

      // Prefer server-computed crossings (accurate window, full spin history,
      // consistent across clients); fall back to client-computed reduction if
      // the server endpoint hasn't resolved yet.
      const serverCx = serverCrossingsBySlug.get(station.slug);
      const scoresUnavailable = displayMode === "blended" && blendedCrossings == null && !blendedError;
      const crossings =
        serverCx !== undefined
          ? serverCx.crossings
          : scoresUnavailable
            ? 0
          : shows.reduce((sum, sh) => sum + (sh.state !== "future" ? sh.crossings : 0), 0);
      const artistCrossings =
        serverCx !== undefined
          ? serverCx.artistCrossings
          : scoresUnavailable
            ? 0
          : shows.reduce((sum, sh) => sum + (sh.state !== "future" ? sh.artistCrossings : 0), 0);
      // Lifetime counts: server always provides these; client-side fallback
      // uses the same show-level sums as a best-effort approximation.
      const lifetimeCrossings =
        serverCx !== undefined
          ? serverCx.lifetimeCrossings
          : scoresUnavailable
            ? 0
          : crossings; // fallback: same as 24h sum until server data arrives
      const lifetimeArtistCrossings =
        serverCx !== undefined
          ? serverCx.lifetimeArtistCrossings
          : scoresUnavailable
            ? 0
          : artistCrossings;
      // Week / month counts: server-only (no client-side schedule-derived fallback).
      const weekCrossings = serverCx !== undefined ? serverCx.weekCrossings : 0;
      const weekArtistCrossings = serverCx !== undefined ? serverCx.weekArtistCrossings : 0;
      const monthCrossings = serverCx !== undefined ? serverCx.monthCrossings : 0;
      const monthArtistCrossings = serverCx !== undefined ? serverCx.monthArtistCrossings : 0;
      const firstPlayCrossings = serverCx?.firstPlayCrossings ?? 0;
      const weekFirstPlayCrossings = serverCx?.weekFirstPlayCrossings ?? 0;
      const monthFirstPlayCrossings = serverCx?.monthFirstPlayCrossings ?? 0;
      const lifetimeFirstPlayCrossings = serverCx?.lifetimeFirstPlayCrossings ?? 0;

      // In blended mode the server returns cumulative top artist names across all
      // active listeners; in personal mode leave empty (DialView reads per-show data).
      const topArtistNames: string[] =
        displayMode === "blended" && serverCx?.topArtistNames?.length
          ? serverCx.topArtistNames
          : [];

      // Per-window artist names: only populated in personal mode (the server
      // returns them from the crossings aggregate queries).  In blended mode
      // the flat topArtistNames is used for the provenance sentence instead.
      const topArtistNames24h: string[] =
        displayMode !== "blended" ? (serverCx?.topArtistNames24h ?? []) : [];
      const topArtistNames7d: string[] =
        displayMode !== "blended" ? (serverCx?.topArtistNames7d ?? []) : [];
      const topArtistNamesLifetime: string[] =
        displayMode !== "blended" ? (serverCx?.topArtistNamesLifetime ?? []) : [];

      return {
        station,
        isLive,
        shows,
        crossings,
        artistCrossings,
        firstPlayCrossings,
        weekCrossings,
        weekArtistCrossings,
        weekFirstPlayCrossings,
        monthCrossings,
        monthArtistCrossings,
        monthFirstPlayCrossings,
        lifetimeCrossings,
        lifetimeArtistCrossings,
        lifetimeFirstPlayCrossings,
        topArtistNames,
        topArtistNames24h,
        topArtistNames7d,
        topArtistNamesLifetime,
        liveTrack: isLive ? (nowPlayingBySlug.get(station.slug) ?? null) : null,
      };
    })
    // Determine which stations to surface in the Dial:
    //   1. Any station that is currently live (has a now-playing signal)
    //   2. Any "flagship" curated station (editorially selected) — shown even when
    //      today's schedule data hasn't arrived yet so the dial is never empty
    //   3. Any other station that has at least one named show (not "Unknown show")
    //      — keeps Radio Browser stations with no show metadata out of the view
    .filter((ds) => {
      // includeAllStations: the main SplitHome view lists every station
      // alphabetically, off-air ones included, so it bypasses this
      // visibility filter entirely.
      if (includeAllStations) return true;
      // Personal stations have no server pulse or schedule — the live /
      // flagship / named-show rules would always hide them. The listener
      // explicitly pinned them, so they always pass.
      if (personalSlugs.has(ds.station.slug)) return true;
      if (ds.isLive) return true;
      if (ds.station.tier === "flagship") return true;
      return ds.shows.some(
        (sh) =>
          sh.showName !== "Unknown show" &&
          sh.showName !== "Unknown" &&
          sh.showName.trim().length > 0,
      );
    });
  }, [stationsData, ambientData, specialistData, categories, wantAmbient, wantSpecialist, metaCategories, personalStations, liveBySlug, nowPlayingBySlug, runsBySlug, spinsBySlug, serverCrossingsBySlug, displayMode, blendedCrossings, blendedError, sleepMode, eraGenreMode, includeAllStations]);

  const isLoading = stationsLoading || liveLoading || schedLoading || spinsLoading
    || (categories != null && wantAmbient && ambientLoading)
    || (categories != null && wantSpecialist && specialistLoading);
  // isCoreLoading: only block until the station list arrives so the offline
  // section and Zone 3 appear immediately.  Zone 1 has its own crossingsLoading
  // gate so it shows a context-sensitive placeholder instead of loading nothing.
  const isCoreLoading = stationsLoading;

  // hasLibrary: true once the server confirms the library has ≥ 1 resolved MBID.
  // Passed to DialView so the Zone 1 loading placeholder can show the right CTA.
  // Sourced from GET /api/me/picker-names so no MBID list download is needed.
  const hasLibrary = pickerNamesData?.hasLibrary ?? false;

  // hasSeeds: true when the user has entered at least one taste-seed artist.
  // Allows Zone1Placeholder to show the seeded-matching state instead of the
  // full onboarding prompt even before the library is imported.
  const hasSeeds = pickerNamesData?.hasSeeds ?? false;

  const liveArtistSuggestions = useMemo(
    () => extractLiveArtistSuggestions(stations, 24),
    [stations],
  );
  const onboardingArtists = useMemo(
    () => mergeOnboardingArtists(artistFrequencyData?.artists ?? [], liveArtistSuggestions),
    [artistFrequencyData, liveArtistSuggestions],
  );

  // Scan lens source: the raw base list, unfiltered by the category filter,
  // UNION the ambient/specialist mode pools (Scan covers every category, and
  // those stations only exist in their mode pools). Deduped by id — a
  // station can be both crossing-eligible and in a mode pool. Only
  // meaningful when the base list was fetched (scanActive or a filter that
  // includes the normal list); otherwise an empty array.
  const scanStations = useMemo((): Station[] => {
    if (!(wantNormalList || scanActive)) return [];
    if (!scanActive) return stationsData?.stations ?? [];
    const byId = new Map<number, Station>();
    for (const s of stationsData?.stations ?? []) byId.set(s.id, s);
    for (const s of ambientData?.stations ?? []) byId.set(s.id, s);
    for (const s of specialistData?.stations ?? []) byId.set(s.id, s);
    return [...byId.values()];
  }, [wantNormalList, scanActive, stationsData, ambientData, specialistData]);

  return {
    stations,
    scanStations,
    scanNowPlaying,
    spinsBySlug,
    isLoading,
    isCoreLoading,
    liveLoading,
    crossingsLoading: selectedCrossingsLoading,
    hasLibrary,
    hasSeeds,
    liveArtistSuggestions,
    onboardingArtists,
    onboardingArtistsLoading: artistFrequencyLoading,
    overlapByPickerId,
    pickerNameToId,
    crossingSourceMode,
    crossingError: displayMode === "blended" && blendedError && blendedCrossings == null,
    crossingsPhase: selectedCrossingsPhase,
    stationsError: stationsError
      || (categories != null && wantAmbient && ambientError)
      || (categories != null && wantSpecialist && specialistError),
    refetchStations: () => {
      void refetchStations();
      if (categories != null && wantAmbient) void refetchAmbient();
      if (categories != null && wantSpecialist) void refetchSpecialist();
    },
    applyNowPlayingOverride,
  };
}
