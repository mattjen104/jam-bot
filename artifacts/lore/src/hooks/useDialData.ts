/**
 * useDialData — assembles all the data the Dial view needs in one place.
 *
 * Fetches:
 *   - station list (with live pulse)
 *   - rolling 24-hour schedule runs (show blocks per station, today + yesterday)
 *   - rolling 24-hour recent spins per station (today + yesterday)
 *   - user's full library MBIDs (for library-crossing detection)
 *   - picked MBIDs lookup (to detect picker/selector shows)
 *
 * Both schedule and recent-spins cover the past 24 hours (today + yesterday)
 * so that overnight shows that started before midnight are included in the
 * `crossings` count. The server endpoints filter by calendar day, so we fetch
 * both days and merge the results client-side.
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
  useLookupPickedMbids,
  getLookupPickedMbidsQueryKey,
  type Station,
  type StationScheduleRun,
  type StationRecentSpin,
} from "@workspace/api-client-react";
import { useMyLibraryMbids } from "../lib/meHooks";

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
}

export interface DialStation {
  station: Station;
  /** true when the station is airing right now */
  isLive: boolean;
  shows: DialShow[];
  /** total library crossings across all past+live shows */
  crossings: number;
}

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

function topArtistsFromSpins(spins: DialSpin[], max = 3, hitField: "isLibraryHit" | "isArtistHit" = "isLibraryHit"): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sp of spins) {
    if (sp[hitField] && sp.artist && !seen.has(sp.artist)) {
      seen.add(sp.artist);
      out.push(sp.artist);
      if (out.length >= max) break;
    }
  }
  return out;
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
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useDialData(): {
  stations: DialStation[];
  isLoading: boolean;
  isCoreLoading: boolean;
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

  // ── recent spins (today + yesterday for rolling 24h window) ──────────────
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
  // Yesterday's spins — needed to count library crossings on overnight shows.
  const { data: spinsDataYesterday } = useGetStationsRecentSpins(
    { date: yesterday },
    {
      query: {
        queryKey: getGetStationsRecentSpinsQueryKey({ date: yesterday }),
        staleTime: 5 * 60_000,
        refetchInterval: 10 * 60_000,
      },
    },
  );

  // ── user library MBIDs + release-group MBIDs (all resolved, no pagination cap) ──
  const { data: libraryData } = useMyLibraryMbids();
  const libraryMbids = libraryData?.mbids ?? [];

  const libraryMbidSet = useMemo(
    () => new Set(libraryMbids),
    [libraryMbids],
  );
  // Release-group set: if ANY track from the same album is in the library,
  // isLibraryHit fires. Widening from exact MBID → release group is the
  // primary fix for "◆ playing X" not appearing (stations air different releases).
  const libraryReleaseGroupSet = useMemo(
    () => new Set(libraryData?.releaseGroupMbids ?? []),
    [libraryData],
  );
  // Artist set: stations that play any track by a library artist get rung 3 on
  // the dial, even when the exact recording isn't in the library.
  const libraryArtistMbidSet = useMemo(
    () => new Set(libraryData?.artistMbids ?? []),
    [libraryData],
  );

  // ── picker detection via library MBID lookup ──────────────────────────────
  // Use library MBIDs to discover which selector/DJ names are in the system.
  // This gives us the set of picker names to mark picker shows.
  const batch1 = useMemo(() => libraryMbids.slice(0, 30), [libraryMbids]);
  const batch2 = useMemo(() => libraryMbids.slice(30, 60), [libraryMbids]);

  const mbids1Str = batch1.join(",") || "_";
  const { data: hits1 } = useLookupPickedMbids(
    { mbids: mbids1Str },
    {
      query: {
        queryKey: getLookupPickedMbidsQueryKey({ mbids: mbids1Str }),
        enabled: batch1.length > 0,
        staleTime: 5 * 60_000,
      },
    },
  );
  const mbids2Str = batch2.join(",") || "_";
  const { data: hits2 } = useLookupPickedMbids(
    { mbids: mbids2Str },
    {
      query: {
        queryKey: getLookupPickedMbidsQueryKey({ mbids: mbids2Str }),
        enabled: batch2.length > 0,
        staleTime: 5 * 60_000,
      },
    },
  );

  // Set of selector/picker display names
  const pickerNames = useMemo((): Set<string> => {
    const names = new Set<string>();
    for (const item of [...(hits1?.items ?? []), ...(hits2?.items ?? [])]) {
      if (item.picker?.name) names.add(item.picker.name);
    }
    return names;
  }, [hits1, hits2]);

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

  // MBID → primary release-group MBID, derived from the recent-spins response.
  // Declared early so nowPlayingBySlug (live chip) can use it for release-group
  // expansion without a separate server round-trip.
  const rgByMbid = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of spinsData?.items ?? []) {
      for (const sp of item.spins) {
        if (sp.mbid && sp.releaseGroupMbid) {
          m.set(sp.mbid, sp.releaseGroupMbid);
        }
      }
    }
    return m;
  }, [spinsData]);

  // ── live now-playing track per station (for live block currentTrack) ───────
  // REST poll data is the baseline; SSE overrides (fired the moment a spin is
  // persisted) are merged on top so live chips update instantly instead of
  // waiting up to 30s for the next poll cycle.
  const nowPlayingBySlug = useMemo((): Map<string, DialSpin> => {
    const m = new Map<string, DialSpin>();

    /** True when the recording's exact MBID is in the library, OR when any
     *  track from the same release group is. The release group is looked up
     *  from the recent-spins data (rgByMbid) when not supplied directly. */
    const hitCheck = (mbid: string | null, releaseGroupMbid?: string | null): boolean => {
      if (mbid != null && libraryMbidSet.has(mbid)) return true;
      const rg = releaseGroupMbid ?? (mbid != null ? rgByMbid.get(mbid) : undefined);
      return rg != null && libraryReleaseGroupSet.has(rg);
    };

    for (const item of liveData?.items ?? []) {
      const np = item.nowPlaying;
      if (!np) continue;
      const title = (np as { title?: string | null }).title ?? (np as { rawTitle?: string | null }).rawTitle ?? "";
      const artist = (np as { artist?: string | null }).artist ?? (np as { rawArtist?: string | null }).rawArtist ?? "";
      if (!title && !artist) continue;
      const mbid = (np as { mbid?: string | null }).mbid ?? null;
      const artistMbid = (np as { artistMbid?: string | null }).artistMbid ?? null;
      const isLibraryHit = hitCheck(mbid);
      m.set(item.slug, {
        mbid,
        artistMbid,
        title,
        artist,
        playedAt: new Date().toISOString(),
        isLibraryHit,
        isArtistHit: !isLibraryHit && artistMbid != null && libraryArtistMbidSet.has(artistMbid),
      });
    }
    // SSE overrides: more recent than the REST poll, applied last so the Dial
    // chip reflects the current on-air track the moment it is logged.
    for (const [slug, entry] of sseOverrides) {
      const isLibraryHit = hitCheck(entry.mbid);
      m.set(slug, {
        mbid: entry.mbid,
        artistMbid: entry.artistMbid,
        title: entry.title,
        artist: entry.artist,
        playedAt: entry.playedAt,
        isLibraryHit,
        isArtistHit: !isLibraryHit && entry.artistMbid != null && libraryArtistMbidSet.has(entry.artistMbid),
      });
    }
    return m;
  }, [liveData, sseOverrides, libraryMbidSet, libraryReleaseGroupSet, libraryArtistMbidSet, rgByMbid]);

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
    // Yesterday first; today's spins are appended so newest-first sorting
    // (done during station assembly) handles ordering correctly.
    for (const item of spinsDataYesterday?.items ?? []) {
      m.set(item.stationSlug, [...item.spins]);
    }
    for (const item of spinsData?.items ?? []) {
      const existing = m.get(item.stationSlug);
      if (existing) {
        existing.push(...item.spins);
      } else {
        m.set(item.stationSlug, [...item.spins]);
      }
    }
    return m;
  }, [spinsData, spinsDataYesterday]);

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
          .map((sp) => {
            // Exact MBID match OR any track from the same release group is in
            // the library — album-level widening so a different pressing or
            // bonus-track edition still triggers the library crossing.
            const exactHit = sp.mbid != null && libraryMbidSet.has(sp.mbid);
            const rgHit = !exactHit && sp.releaseGroupMbid != null && libraryReleaseGroupSet.has(sp.releaseGroupMbid);
            // Artist hit: artist is in library but this exact recording/album isn't.
            const artistHit = !exactHit && !rgHit && sp.artistMbid != null && libraryArtistMbidSet.has(sp.artistMbid);
            return {
              mbid: sp.mbid,
              artistMbid: sp.artistMbid ?? null,
              title: sp.title,
              artist: sp.artist,
              playedAt: sp.playedAt,
              isLibraryHit: exactHit || rgHit,
              isArtistHit: artistHit,
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
        const isPickerShow = run.show?.djName != null && pickerNames.has(run.show.djName);

        return {
          runId: run.runId,
          showName: run.show?.name ?? "Unknown show",
          djName: run.show?.djName ?? null,
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

      const crossings = shows.reduce(
        (sum, sh) => sum + (sh.state !== "future" ? sh.crossings : 0),
        0,
      );

      return { station, isLive, shows, crossings };
      // Note: station-level artistCrossings are intentionally not pre-summed here —
      // the dial reads them per-show via reason(), so no aggregate is needed.
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
  }, [stationsData, liveBySlug, nowPlayingBySlug, runsBySlug, spinsBySlug, libraryMbidSet, libraryReleaseGroupSet, libraryArtistMbidSet, pickerNames]);

  const isLoading = stationsLoading || liveLoading || schedLoading || spinsLoading;
  // Narrower gate: only blocks until we know which stations are live vs offline.
  // Schedule and spin data enrich crossings/show info but arrive later; the
  // front door can render safely once the station list and live pulse are ready.
  const isCoreLoading = stationsLoading || liveLoading;

  return { stations, isLoading, isCoreLoading };
}
