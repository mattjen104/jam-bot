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
import { useMemo, useState, useEffect } from "react";
import {
  useListStations,
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
import { useMyPickerNames, useMyDialCrossings, useMyPickerOverlap } from "../lib/meHooks";
import { eligibleDjName } from "@workspace/lore-attribution";

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
  title: string;
  artist: string;
  playedAt: string;
  /** Exact recording or release-group match against user's library. */
  isLibraryHit: boolean;
  /** Artist is in the user's library but this exact track/album is not. */
  isArtistHit: boolean;
  /** First-ever appearance of this recording (by MBID) in the archive. */
  isFirstSpin: boolean;
}

export interface DialShow {
  runId: number | string | null;
  showName: string;
  djName: string | null;
  startedAt: string;
  endedAt: string;
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
  /** lifetime (all-time) exact-MBID/release-group crossings — primary sort key for unattributed rows */
  lifetimeCrossings: number;
  /** lifetime artist-level crossings — all-time equivalent of artistCrossings */
  lifetimeArtistCrossings: number;
  /** Current track from the live pulse, even when schedule data is unavailable. */
  liveTrack?: DialSpin | null;
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
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sp of spins) {
    // Defense in depth for old API responses and cached timeline data. Domain
    // values are radio metadata/ad slots, never artist names.
    const artist = sp.artist?.trim() ?? "";
    const domainLike = /^(?:https?:\/\/|[a-z0-9][a-z0-9.-]*\.(?:com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)(?:[/?#\s]|$))/i.test(artist);
    if (sp[hitField] && artist && !domainLike && !seen.has(artist)) {
      seen.add(artist);
      out.push(artist);
      if (out.length >= max) break;
    }
  }
  return out;
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
    const artist = item.artist?.replace(/\s+/g, " ").trim();
    const key = liveIdentityKey(artist);
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
  title: string;
  artist: string;
  playedAt: string;
  isFirstSpin: boolean;
  /** Server-computed hit flags — sent in the spin-changed SSE payload. */
  isLibraryHit: boolean;
  isArtistHit: boolean;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useDialData(): {
  stations: DialStation[];
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
} {
  const today = todayStr();
  const yesterday = yesterdayStr();

  // ── SSE override: instant now-playing from the server's spin-changed stream ─
  // When the server persists a new spin it pushes a spin-changed SSE event.
  // We store the latest entry per station slug so the Dial updates immediately
  // instead of waiting up to 30s for the REST poll to catch up.
  const [sseOverrides, setSseOverrides] = useState<Map<string, SseSpinEntry>>(
    () => new Map(),
  );
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/stations/now-playing/stream");
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data as string) as {
          stationSlug?: string;
          rawArtist?: string;
          rawTitle?: string;
          mbid?: string | null;
          artistMbid?: string | null;
          isFirstSpin?: boolean;
          isLibraryHit?: boolean;
          isArtistHit?: boolean;
        };
        if (!ev.stationSlug) return;
        setSseOverrides((prev) => {
          const next = new Map(prev);
          next.set(ev.stationSlug!, {
            mbid: ev.mbid ?? null,
            artistMbid: ev.artistMbid ?? null,
            title: ev.rawTitle ?? "",
            artist: ev.rawArtist ?? "",
            playedAt: new Date().toISOString(),
            isFirstSpin: ev.isFirstSpin ?? false,
            // Hit flags computed server-side per listener at spin-write time.
            isLibraryHit: ev.isLibraryHit ?? false,
            isArtistHit: ev.isArtistHit ?? false,
          });
          return next;
        });
      } catch {
        // ignore unparseable frames (ping comments arrive as empty data)
      }
    };
    return () => es.close();
  }, []);

  // ── fetch stations ──────────────────────────────────────────────────────
  const { data: stationsData, isLoading: stationsLoading } = useListStations();

  // ── live pulse (30s polling) ─────────────────────────────────────────────
  const { data: liveData, isLoading: liveLoading } = useListStationsNowPlaying({
    query: {
      queryKey: getListStationsNowPlayingQueryKey(),
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  });

  // ── schedule runs (today + yesterday for rolling 24h window) ────────────
  const { data: scheduleData, isLoading: schedLoading } = useGetStationsSchedule(
    { date: today },
    {
      query: {
        queryKey: getGetStationsScheduleQueryKey({ date: today }),
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
        staleTime: 10 * 60_000,
        refetchInterval: 10 * 60_000,
      },
    });

  // ── server-computed crossing scores (rolling 24h, full spin history) ────────
  // These replace the client-side crossing reduction at the station level so
  // ranking is consistent across clients and not bounded by the fetch page cap.
  const { data: serverCrossings, isLoading: crossingsLoading } = useMyDialCrossings(today);

  const serverCrossingsBySlug = useMemo(() => {
    const m = new Map<string, { crossings: number; artistCrossings: number; lifetimeCrossings: number; lifetimeArtistCrossings: number }>();
    for (const cx of serverCrossings ?? []) {
      m.set(cx.stationSlug, {
        crossings: cx.crossings,
        artistCrossings: cx.artistCrossings,
        lifetimeCrossings: cx.lifetimeCrossings,
        lifetimeArtistCrossings: cx.lifetimeArtistCrossings,
      });
    }
    return m;
  }, [serverCrossings]);

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
  // A station is "live" only if its most-recent spin arrived within the last
  // 60 minutes.  The endpoint returns the all-time latest spin per station,
  // so a stale entry (hours/days old) must not be treated as currently on-air.
  // 60 min is generous enough to cover slow-polling hosts while still reliably
  // excluding stations that are genuinely off-air.
  // NB: different from module-level LIVE_WINDOW_MS (20 min show-state window).
  const LIVE_PULSE_WINDOW_MS = 60 * 60 * 1000;
  const liveBySlug = useMemo(() => {
    const m = new Map<string, boolean>();
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
  const nowPlayingBySlug = useMemo((): Map<string, DialSpin> => {
    const m = new Map<string, DialSpin>();

    for (const item of liveData?.items ?? []) {
      const np = item.nowPlaying;
      if (!np) continue;
      const title = (np as { title?: string | null }).title ?? (np as { rawTitle?: string | null }).rawTitle ?? "";
      const artist = (np as { artist?: string | null }).artist ?? (np as { rawArtist?: string | null }).rawArtist ?? "";
      if (!title && !artist) continue;
      const mbid = (np as { mbid?: string | null }).mbid ?? null;
      const artistMbid = (np as { artistMbid?: string | null }).artistMbid ?? null;
      m.set(item.slug, {
        mbid,
        artistMbid,
        title,
        artist,
        playedAt: new Date().toISOString(),
        isLibraryHit: (np as { isLibraryHit?: boolean }).isLibraryHit ?? false,
        isArtistHit: (np as { isArtistHit?: boolean }).isArtistHit ?? false,
        isFirstSpin: (np as { isFirstSpin?: boolean }).isFirstSpin ?? false,
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
        isLibraryHit: entry.isLibraryHit,
        isArtistHit: entry.isArtistHit,
        isFirstSpin: entry.isFirstSpin,
      });
    }
    return m;
  }, [liveData, sseOverrides]);

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

  // ── assemble enriched stations ────────────────────────────────────────────
  const stations = useMemo((): DialStation[] => {
    const raw = stationsData?.stations ?? [];
    // Rolling 24-hour cutoff for crossings. We fetch both today's and
    // yesterday's data so that overnight shows are present, but only spins
    // within the past 24 hours count toward crossings — spins from earlier
    // yesterday (e.g. 6 am when it is now 9 am) are excluded.
    const window24hCutoffMs = Date.now() - 24 * 60 * 60 * 1000;

    return raw.map((station) => {
      const isLive = liveBySlug.get(station.slug) ?? false;
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
          .map((sp) => ({
            mbid: sp.mbid,
            artistMbid: sp.artistMbid ?? null,
            title: sp.title,
            artist: sp.artist,
            playedAt: sp.playedAt,
            // isLibraryHit / isArtistHit computed server-side per listener;
            // returned in the recent-spins response and consumed directly here.
            isLibraryHit: sp.isLibraryHit,
            isArtistHit: sp.isArtistHit,
            isFirstSpin: sp.isFirstSpin ?? false,
          }));

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
        const usableDjName = eligibleDjName(run.show?.djName, {
          artist: currentTrack?.artist,
          title: currentTrack?.title,
          showTitle: run.show?.name,
          stationName: station.name,
        });
        // isPickerShow: derived from pickerId presence on the show row, but
        // never keep a linked picker alive for rejected live attribution.
        const pickerId = run.show?.pickerId ?? null;
        const isPickerShow = pickerId != null && usableDjName != null;

        return {
          runId: run.runId,
          showName: run.show?.name ?? "Unknown show",
          djName: usableDjName,
          pickerId,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
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
      const crossings =
        serverCx !== undefined
          ? serverCx.crossings
          : shows.reduce((sum, sh) => sum + (sh.state !== "future" ? sh.crossings : 0), 0);
      const artistCrossings =
        serverCx !== undefined
          ? serverCx.artistCrossings
          : shows.reduce((sum, sh) => sum + (sh.state !== "future" ? sh.artistCrossings : 0), 0);
      // Lifetime counts: server always provides these; client-side fallback
      // uses the same show-level sums as a best-effort approximation.
      const lifetimeCrossings =
        serverCx !== undefined
          ? serverCx.lifetimeCrossings
          : crossings; // fallback: same as 24h sum until server data arrives
      const lifetimeArtistCrossings =
        serverCx !== undefined
          ? serverCx.lifetimeArtistCrossings
          : artistCrossings;

      return {
        station,
        isLive,
        shows,
        crossings,
        artistCrossings,
        lifetimeCrossings,
        lifetimeArtistCrossings,
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
      if (ds.isLive) return true;
      if (ds.station.tier === "flagship") return true;
      return ds.shows.some(
        (sh) =>
          sh.showName !== "Unknown show" &&
          sh.showName !== "Unknown" &&
          sh.showName.trim().length > 0,
      );
    });
  }, [stationsData, liveBySlug, nowPlayingBySlug, runsBySlug, spinsBySlug, serverCrossingsBySlug]);

  const isLoading = stationsLoading || liveLoading || schedLoading || spinsLoading;
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

  return {
    stations,
    isLoading,
    isCoreLoading,
    liveLoading,
    crossingsLoading,
    hasLibrary,
    hasSeeds,
    liveArtistSuggestions,
    onboardingArtists,
    onboardingArtistsLoading: artistFrequencyLoading,
    overlapByPickerId,
    pickerNameToId,
  };
}
