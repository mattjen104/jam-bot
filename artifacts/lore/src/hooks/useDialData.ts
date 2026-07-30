/**
 * useDialData — assembles all the data the Dial view needs in one place.
 *
 * Fetches:
 *   - station list (with live pulse)
 *   - today's schedule runs (show blocks per station)
 *   - today's recent spins per station
 *   - user's full library MBIDs (for library-crossing detection)
 *   - picked MBIDs lookup (to detect picker/selector shows)
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
  isLibraryHit: boolean;
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
  crossings: number;
  /** up to 3 library-hit artist names, for display on the block */
  topArtists: string[];
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

function topArtistsFromSpins(spins: DialSpin[], max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sp of spins) {
    if (sp.isLibraryHit && !seen.has(sp.artist)) {
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
} {
  const today = todayStr();

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

  // ── schedule runs ────────────────────────────────────────────────────────
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

  // ── recent spins ─────────────────────────────────────────────────────────
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

  // ── user library MBIDs (all resolved, no pagination cap) ─────────────────
  const { data: libraryMbids = [] } = useMyLibraryMbids();

  const libraryMbidSet = useMemo(() => new Set(libraryMbids), [libraryMbids]);

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
  const liveBySlug = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const item of liveData?.items ?? []) {
      m.set(item.slug, item.nowPlaying !== null);
    }
    return m;
  }, [liveData]);

  // ── live now-playing track per station (for live block currentTrack) ───────
  // REST poll data is the baseline; SSE overrides (fired the moment a spin is
  // persisted) are merged on top so live chips update instantly instead of
  // waiting up to 30s for the next poll cycle.
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
        isLibraryHit: mbid != null && libraryMbidSet.has(mbid),
      });
    }
    // SSE overrides: more recent than the REST poll, applied last so the Dial
    // chip reflects the current on-air track the moment it is logged.
    for (const [slug, entry] of sseOverrides) {
      m.set(slug, {
        mbid: entry.mbid,
        artistMbid: entry.artistMbid,
        title: entry.title,
        artist: entry.artist,
        playedAt: entry.playedAt,
        isLibraryHit: entry.mbid != null && libraryMbidSet.has(entry.mbid),
      });
    }
    return m;
  }, [liveData, sseOverrides, libraryMbidSet]);

  const runsBySlug = useMemo(() => {
    const m = new Map<string, StationScheduleRun[]>();
    for (const item of scheduleData?.items ?? []) {
      m.set(item.stationSlug, item.runs);
    }
    return m;
  }, [scheduleData]);

  const spinsBySlug = useMemo(() => {
    const m = new Map<string, StationRecentSpin[]>();
    for (const item of spinsData?.items ?? []) {
      m.set(item.stationSlug, item.spins);
    }
    return m;
  }, [spinsData]);

  // pins are managed externally by DialView; not needed for data assembly

  // ── assemble enriched stations ────────────────────────────────────────────
  const stations = useMemo((): DialStation[] => {
    const raw = stationsData?.stations ?? [];

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

        // Assign spins that fall within this run's time window
        const runSpins: DialSpin[] = sortedSpins
          .filter((sp) => {
            const t = new Date(sp.playedAt).getTime();
            return t >= startMs - 60_000 && t <= endMs + 60_000;
          })
          .map((sp) => ({
            mbid: sp.mbid,
            artistMbid: (sp as { artistMbid?: string | null }).artistMbid ?? null,
            title: sp.title,
            artist: sp.artist,
            playedAt: sp.playedAt,
            isLibraryHit: sp.mbid != null && libraryMbidSet.has(sp.mbid),
          }));

        const crossings = runSpins.filter((sp) => sp.isLibraryHit).length;
        const topArtists = topArtistsFromSpins(runSpins);
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
          topArtists,
          currentTrack,
          isPickerShow,
        };
      });

      const crossings = shows.reduce(
        (sum, sh) => sum + (sh.state !== "future" ? sh.crossings : 0),
        0,
      );

      return { station, isLive, shows, crossings };
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
  }, [stationsData, liveBySlug, nowPlayingBySlug, runsBySlug, spinsBySlug, libraryMbidSet, pickerNames]);

  const isLoading = stationsLoading || liveLoading || schedLoading || spinsLoading;

  return { stations, isLoading };
}
