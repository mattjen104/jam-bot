import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListStations,
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
  useListStationsNowPlaying,
  getListStationsNowPlayingQueryKey,
  useListStationsAtDate,
  getListStationsAtDateQueryKey,
  useGetStationsSchedule,
  getGetStationsScheduleQueryKey,
  useGetStationsRecentSpins,
  getGetStationsRecentSpinsQueryKey,
  useGetRecordingsAvailability,
  getGetRecordingsAvailabilityQueryKey,
  useLookupPickedMbids,
  getLookupPickedMbidsQueryKey,
  type Station,
  type PickedLookupItem,
  type StationScheduleRun,
  type StationRecentSpin,
  type RecordingAvailabilityItem,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { StationList } from "../components/StationList";
import { NowPlaying } from "../components/NowPlaying";
import { FollowingStrip } from "../components/FollowingStrip";
import {
  AudioLines,
  BookMarked,
  BookOpen,
  CalendarDays,
  Radio,
  ShieldCheck,
  UserCheck,
  Waypoints,
} from "lucide-react";

/** YYYY-MM-DD of today in local time. */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Home() {
  const { radio, ride } = usePlayer();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const today = todayStr();

  return (
    <div className="min-h-screen">
      <div
        className={`mx-auto max-w-6xl px-4 pt-8 sm:px-6 ${
          ride.active || radio.station ? "pb-32" : "pb-16"
        }`}
      >
        <header className="mb-8">
          <h1 className="max-w-[18ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground sm:text-5xl">
            Borrow real humans' taste. Never an algorithm.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Live stations, curated lists, and replays of documented broadcasts —
            all at once. Every track resolved to its canonical identity, with
            credits and deep links.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/journal"
              data-testid="link-journal"
              className="hover-elevate inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-foreground"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Your journal
            </Link>
            <Link
              href="/following"
              data-testid="link-following"
              className="hover-elevate inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-foreground"
            >
              <UserCheck className="h-3.5 w-3.5" />
              Following
            </Link>
            <Link
              href="/library"
              data-testid="link-library"
              className="hover-elevate inline-flex items-center gap-2 rounded-full border border-[#C6F53F]/40 bg-[#C6F53F]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#C6F53F]"
            >
              <BookMarked className="h-3.5 w-3.5" />
              Your library
            </Link>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Unmodified streams
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Waypoints className="h-3.5 w-3.5 text-primary" /> Resolved to MusicBrainz
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AudioLines className="h-3.5 w-3.5 text-primary" /> Attribution always
            </span>
          </div>
        </header>

        <FollowingStrip />

        {/* Time sweep — moves the whole dial to a past date */}
        <DateSweep
          selectedDate={selectedDate}
          today={today}
          onChange={setSelectedDate}
        />

        <LiveMode selectedDate={selectedDate} />

        <footer className="mt-16 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground">
          Lore never hosts, proxies, or re-encodes audio. Streams are played
          directly from each broadcaster. Track identities and links are provided
          via MusicBrainz and partners.
        </footer>
      </div>
    </div>
  );
}

/** The page-level time sweep control. */
function DateSweep({
  selectedDate,
  today,
  onChange,
}: {
  selectedDate: string | null;
  today: string;
  onChange: (date: string | null) => void;
}) {
  return (
    <div className="mb-8 flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(null)}
        data-testid="date-sweep-live"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
          selectedDate === null
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:text-foreground"
        }`}
      >
        <Radio className="h-3 w-3" />
        Live
      </button>
      <label className="flex items-center gap-2">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="date"
          max={today}
          min="2014-01-01"
          value={selectedDate ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          data-testid="date-sweep-input"
          className={`rounded-lg border bg-card px-2 py-1 font-mono text-[11px] text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${
            selectedDate
              ? "border-primary/40"
              : "border-border text-muted-foreground"
          }`}
        />
      </label>
      {selectedDate && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#C6F53F]/30 bg-[#C6F53F]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-[#C6F53F]">
          <CalendarDays className="h-3 w-3" />
          Past date
        </span>
      )}
    </div>
  );
}

/** Mode 1 — the live dial with the now-playing sidebar. */
function LiveMode({ selectedDate }: { selectedDate: string | null }) {
  const { data, isLoading, isError } = useListStations();
  const { radio: player } = usePlayer();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const stations = useMemo(() => data?.stations ?? [], [data]);

  const activeSlug = player.station?.slug ?? null;
  const focusedSlug = selectedSlug ?? activeSlug;
  const focusedStation =
    stations.find((s) => s.slug === focusedSlug) ?? player.station ?? null;

  // Schedule date: when sweeping to a past date use that; otherwise today.
  const scheduleDate = useMemo(
    () => selectedDate ?? todayStr(),
    [selectedDate],
  );

  // Live pulse — refetch every 30s when no date is selected.
  const { data: livePulse } = useListStationsNowPlaying({
    query: {
      queryKey: getListStationsNowPlayingQueryKey(),
      refetchInterval: selectedDate ? false : 30000,
      refetchIntervalInBackground: false,
      enabled: !selectedDate,
    },
  });

  // Historical pulse — fetched once for a specific date; no polling.
  const { data: datePulse } = useListStationsAtDate(selectedDate ?? "", {
    query: {
      queryKey: getListStationsAtDateQueryKey(selectedDate ?? ""),
      enabled: !!selectedDate,
      staleTime: 5 * 60 * 1000,
    },
  });

  const pulse = selectedDate ? datePulse : livePulse;

  // Show timeline — all blocks for every station on the schedule date.
  const { data: scheduleData } = useGetStationsSchedule(scheduleDate, {
    query: {
      queryKey: getGetStationsScheduleQueryKey(scheduleDate),
      staleTime: selectedDate ? 5 * 60 * 1000 : 60_000,
      refetchInterval: selectedDate ? false : 2 * 60 * 1000,
    },
  });
  const scheduleBySlug = useMemo((): Map<string, StationScheduleRun[]> => {
    const map = new Map<string, StationScheduleRun[]>();
    for (const item of scheduleData?.items ?? []) {
      map.set(item.stationSlug, item.runs);
    }
    return map;
  }, [scheduleData]);

  // Recent individual spins — powers the track-chip timeline on showless cards.
  const { data: recentSpinsData } = useGetStationsRecentSpins(scheduleDate, {
    query: {
      queryKey: getGetStationsRecentSpinsQueryKey(scheduleDate),
      staleTime: selectedDate ? 5 * 60 * 1000 : 60_000,
      refetchInterval: selectedDate ? false : 2 * 60 * 1000,
    },
  });
  const recentSpinsBySlug = useMemo((): Map<string, StationRecentSpin[]> => {
    const map = new Map<string, StationRecentSpin[]>();
    for (const item of recentSpinsData?.items ?? []) {
      map.set(item.stationSlug, item.spins);
    }
    return map;
  }, [recentSpinsData]);

  const pulseBySlug = useMemo(() => {
    return new Map(
      (pulse?.items ?? []).map((i) => [i.slug, i.nowPlaying ?? null]),
    );
  }, [pulse]);

  // Dial badges: batch every resolved now-playing MBID into one lookup —
  // "which of these songs did a critic/label/curator vouch for?"
  const pulseMbids = useMemo(() => {
    const ids = new Set<string>();
    for (const item of pulse?.items ?? []) {
      const mbid = item.nowPlaying?.recording?.mbid;
      if (mbid) ids.add(mbid);
    }
    return [...ids].sort().join(",");
  }, [pulse]);
  const { data: pickedData } = useLookupPickedMbids(
    { mbids: pulseMbids },
    {
      query: {
        queryKey: getLookupPickedMbidsQueryKey({ mbids: pulseMbids }),
        enabled: pulseMbids.length > 0,
      },
    },
  );
  const pickedBySlug = useMemo(() => {
    const byMbid = new Map<string, PickedLookupItem>(
      (pickedData?.items ?? []).map((it) => [it.mbid, it]),
    );
    const map = new Map<string, PickedLookupItem>();
    for (const item of pulse?.items ?? []) {
      const mbid = item.nowPlaying?.recording?.mbid;
      if (!mbid) continue;
      const hit = byMbid.get(mbid);
      if (hit) map.set(item.slug, hit);
    }
    return map;
  }, [pulse, pickedData]);

  // Metadata availability — which current tracks have lyrics / SE episodes.
  const { data: availabilityData } = useGetRecordingsAvailability(pulseMbids, {
    query: {
      queryKey: getGetRecordingsAvailabilityQueryKey(pulseMbids),
      enabled: pulseMbids.length > 0,
      staleTime: 60_000,
    },
  });
  const availabilityBySlug = useMemo((): Map<string, RecordingAvailabilityItem> => {
    const byMbid = new Map<string, RecordingAvailabilityItem>(
      (availabilityData?.items ?? []).map((it) => [it.mbid, it]),
    );
    const map = new Map<string, RecordingAvailabilityItem>();
    for (const item of pulse?.items ?? []) {
      const mbid = item.nowPlaying?.recording?.mbid;
      if (!mbid) continue;
      const hit = byMbid.get(mbid);
      if (hit) map.set(item.slug, hit);
    }
    return map;
  }, [pulse, availabilityData]);

  const { data: nowPlaying, isLoading: npLoading } = useGetStationNowPlaying(
    focusedSlug ?? "",
    {
      query: {
        queryKey: getGetStationNowPlayingQueryKey(focusedSlug ?? ""),
        enabled: !!focusedSlug && !selectedDate,
        refetchInterval: selectedDate ? false : 15000,
        refetchIntervalInBackground: false,
      },
    },
  );

  const handleSelect = (station: Station) => setSelectedSlug(station.slug);
  const handleToggle = (station: Station) => {
    setSelectedSlug(station.slug);
    void player.toggle(station);
  };

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-serif text-xl font-semibold text-foreground">
          {selectedDate ? (
            <>
              The dial <span className="text-muted-foreground">·</span>{" "}
              <span className="font-mono text-base text-muted-foreground">
                {selectedDate}
              </span>
            </>
          ) : (
            "The dial"
          )}
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {stations.length} station{stations.length === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading && <StationListSkeleton />}
      {isError && (
        <div className="rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground">
          Couldn't load the station directory. Please refresh.
        </div>
      )}
      {!isLoading && !isError && stations.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
          No stations are on the dial yet.
        </div>
      )}
      {!isLoading && stations.length > 0 && (
        <StationList
          stations={stations}
          activeSlug={activeSlug}
          status={player.status}
          pulse={pulseBySlug}
          picked={pickedBySlug}
          schedule={scheduleBySlug}
          recentSpins={recentSpinsBySlug}
          availability={availabilityBySlug}
          onToggle={handleToggle}
          onSelect={handleSelect}
        />
      )}

      {/* Now-playing sidebar only shown in live mode — not meaningful for ghost snapshots */}
      {!selectedDate && (
        <aside className="mt-8 xl:hidden">
          <NowPlaying
            data={nowPlaying}
            isLoading={npLoading}
            fallbackStation={focusedStation}
          />
        </aside>
      )}
    </section>
  );
}

function StationListSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-3"
        >
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
