import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useIcecastFallback } from "../hooks/useIcecastFallback";
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
  useGetPickersDial,
  getGetPickersDialQueryKey,
  useGetAllScrapedShows,
  getGetAllScrapedShowsQueryKey,
  type Station,
  type PickedLookupItem,
  type StationScheduleRun,
  type StationRecentSpin,
  type RecordingAvailabilityItem,
  type PickerDialItem,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { useFollows, isFollowed } from "../lib/local";
import { useNtsChannel1, useNtsChannel2 } from "../hooks/useNtsClientLive";
import { StationList } from "../components/StationList";
import { SelectorDial } from "../components/SelectorDial";
import { NowPlaying } from "../components/NowPlaying";
import { FollowingStrip } from "../components/FollowingStrip";
import {
  AudioLines,
  BookMarked,
  BookOpen,
  CalendarDays,
  Map as MapIcon,
  Radio,
  Search,
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
            <Link
              href="/taste-map"
              data-testid="link-taste-map"
              className="hover-elevate inline-flex items-center gap-2 rounded-full border border-[#a78bfa]/40 bg-[#a78bfa]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#a78bfa]"
            >
              <MapIcon className="h-3.5 w-3.5" />
              Taste map
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

type DialFilterTab = "all" | "live" | "flagship" | "featured" | "lists" | "following";
type DialSort = "default" | "popularity" | "discovery";

/** Sort/genre controls for the station dial. Purely client-side — the full
 * station list is already loaded, so no extra network round-trip is needed. */
function DialSortAndGenre({
  sort,
  onSortChange,
  genre,
  onGenreChange,
  genreOptions,
  descriptionOnly,
  onDescriptionOnlyChange,
  search,
  onSearchChange,
}: {
  sort: DialSort;
  onSortChange: (sort: DialSort) => void;
  genre: string | null;
  onGenreChange: (genre: string | null) => void;
  genreOptions: string[];
  descriptionOnly: boolean;
  onDescriptionOnlyChange: (value: boolean) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const sorts: { id: DialSort; label: string }[] = [
    { id: "default", label: "Curated order" },
    { id: "popularity", label: "Most popular" },
    { id: "discovery", label: "Discovery" },
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/* Search input */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search stations…"
          data-testid="dial-search-input"
          className="w-44 rounded-full border border-border bg-card py-1 pl-7 pr-3 font-mono text-[11px] text-foreground placeholder-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as DialSort)}
        data-testid="dial-sort-select"
        className="rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {sorts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {genreOptions.length > 0 && (
        <select
          value={genre ?? ""}
          onChange={(e) => onGenreChange(e.target.value || null)}
          data-testid="dial-genre-select"
          className="rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All genres</option>
          {genreOptions.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => onDescriptionOnlyChange(!descriptionOnly)}
        data-testid="dial-description-filter"
        aria-pressed={descriptionOnly}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
          descriptionOnly
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:text-foreground"
        }`}
      >
        Has description
      </button>
    </div>
  );
}

/** Four-tab filter that narrows the dial to stations, lists, or followed items. */
function DialFilter({
  active,
  onChange,
  followCount,
}: {
  active: DialFilterTab;
  onChange: (tab: DialFilterTab) => void;
  followCount: number;
}) {
  const tabs: { id: DialFilterTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "live", label: "Live" },
    { id: "flagship", label: "Flagship" },
    { id: "featured", label: "Featured" },
    { id: "lists", label: "Lists" },
    { id: "following", label: "Following" },
  ];
  return (
    <div className="mb-4 flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
            active === tab.id
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
          {tab.id === "following" && followCount > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 font-mono text-[9px] tabular-nums text-primary">
              {followCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Mode 1 — the live dial with the now-playing sidebar. */
const QUALITY_TIERS_VISIBLE = new Set(["proven", "promising"]);
const LS_SHOW_ALL = "lore:showAllStations";

function LiveMode({ selectedDate }: { selectedDate: string | null }) {
  const { data, isLoading, isError } = useListStations();
  const { radio: player } = usePlayer();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [dialFilter, setDialFilter] = useState<DialFilterTab>("all");
  const [dialSort, setDialSort] = useState<DialSort>("default");
  const [dialGenre, setDialGenre] = useState<string | null>(null);
  const [descriptionOnly, setDescriptionOnly] = useState(false);
  const [dialSearch, setDialSearch] = useState("");
  const [showAllStations, setShowAllStations] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_SHOW_ALL) === "true";
    } catch {
      return false;
    }
  });
  const follows = useFollows();

  const handleShowAllToggle = () => {
    const next = !showAllStations;
    setShowAllStations(next);
    try {
      localStorage.setItem(LS_SHOW_ALL, String(next));
    } catch {
      // ignore
    }
  };

  // Client-side NTS show data — NTS blocks datacenter IPs but browser requests
  // from residential IPs work fine. These queries run in the browser and refresh
  // every 2 minutes, matching NTS show durations.
  const { data: nts1Show } = useNtsChannel1();
  const { data: nts2Show } = useNtsChannel2();

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
      queryKey: getListStationsAtDateQueryKey(selectedDate ?? "") as readonly unknown[],
      enabled: !!selectedDate,
      staleTime: 5 * 60 * 1000,
    },
  });

  const pulse = selectedDate ? datePulse : livePulse;

  // Show timeline — all blocks for every station on the schedule date.
  const { data: scheduleData } = useGetStationsSchedule({ date: scheduleDate }, {
    query: {
      queryKey: getGetStationsScheduleQueryKey({ date: scheduleDate }),
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
  const { data: recentSpinsData } = useGetStationsRecentSpins({ date: scheduleDate }, {
    query: {
      queryKey: getGetStationsRecentSpinsQueryKey({ date: scheduleDate }),
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

  // Scraped weekly schedule — used to show what's currently on air per station.
  const { data: scrapedData } = useGetAllScrapedShows({
    query: {
      queryKey: getGetAllScrapedShowsQueryKey(),
      staleTime: 10 * 60 * 1000,
    },
  });

  // Curated picker dial — all active lists with mosaic artwork.
  // Fetched once; no polling (lists update infrequently).
  const { data: pickerDialData } = useGetPickersDial({
    query: {
      queryKey: getGetPickersDialQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });
  const pickerItems = useMemo(
    (): PickerDialItem[] => pickerDialData?.items ?? [],
    [pickerDialData],
  );

  // Derive follow counts for the badge on the Following tab.
  const dialFollowCount = useMemo(
    () => follows.filter((f) => f.kind === "station" || f.kind === "picker").length,
    [follows],
  );

  // Genre options derived from what's actually playing right now — ranked by
  // how many stations are currently broadcasting that genre.
  const genreOptions = useMemo((): string[] => {
    const counts = new Map<string, number>();
    for (const item of pulse?.items ?? []) {
      for (const g of item.nowPlaying?.recording?.genres ?? []) {
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([g]) => g);
  }, [pulse]);

  // Map slug → the show currently airing based on the scraped weekly schedule.
  // Only computed in live mode (selectedDate = null); falls back gracefully
  // if scraped data hasn't loaded yet.
  const currentShowBySlug = useMemo((): Map<string, { showName: string; djName: string | null }> => {
    const map = new Map<string, { showName: string; djName: string | null }>();
    if (!scrapedData?.stations || selectedDate) return map;
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
    const now = new Date();
    const currentDay = DOW[now.getDay()];
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const station of scrapedData.stations) {
      const todayShows = station.shows
        .filter((s) => s.dayOfWeek === currentDay)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      let current: { showName: string; djName: string | null } | null = null;
      for (const show of todayShows) {
        const [sh, sm] = show.startTime.split(":").map(Number);
        const startMin = (sh ?? 0) * 60 + (sm ?? 0);
        if (startMin > nowMin) break;
        if (show.endTime) {
          const [eh, em] = show.endTime.split(":").map(Number);
          const endMin = (eh ?? 0) * 60 + (em ?? 0);
          current = nowMin < endMin ? { showName: show.showName, djName: show.djName ?? null } : null;
        } else {
          current = { showName: show.showName, djName: show.djName ?? null };
        }
      }
      if (current) map.set(station.slug, current);
    }
    return map;
  }, [scrapedData, selectedDate]);

  // Client-side filter — no network traffic.
  const filteredStations = useMemo((): Station[] => {
    let result = stations;
    if (dialFilter === "lists") return [];
    if (dialFilter === "flagship")
      result = result.filter((s) => s.tier === "flagship");
    if (dialFilter === "featured")
      result = result.filter(
        (s) => !!s.homepageBlurb || (s.upcomingShowCount ?? 0) > 0,
      );
    if (dialFilter === "following")
      result = result.filter((s) => isFollowed(follows, "station", s.slug));

    if (dialGenre) {
      const genresBySlug = new Map(
        (pulse?.items ?? [])
          .filter((i) => i.nowPlaying?.recording?.genres?.length)
          .map((i) => [i.slug, i.nowPlaying!.recording!.genres!] as const),
      );
      result = result.filter((s) =>
        (genresBySlug.get(s.slug) ?? []).includes(dialGenre),
      );
    }

    if (descriptionOnly)
      result = result.filter(
        (s) => !!s.homepageBlurb && s.homepageBlurb.trim().length > 0,
      );

    if (dialSearch.trim()) {
      const q = dialSearch.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.org ?? "").toLowerCase().includes(q) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }

    if (dialSort === "popularity") {
      result = [...result].sort(
        (a, b) => (b.votes ?? 0) + (b.clickcount ?? 0) - ((a.votes ?? 0) + (a.clickcount ?? 0)),
      );
    } else if (dialSort === "discovery") {
      result = [...result].sort(
        (a, b) => (b.discoveryScore ?? -1) - (a.discoveryScore ?? -1),
      );
    }

    return result;
  }, [dialFilter, dialSort, dialGenre, descriptionOnly, dialSearch, stations, follows, pulse]);

  // Quality-gated view: when showAllStations is false, only show proven/promising.
  const visibleStations = useMemo(() => {
    if (showAllStations) return filteredStations;
    return filteredStations.filter((s) =>
      s.qualityTier != null && QUALITY_TIERS_VISIBLE.has(s.qualityTier),
    );
  }, [filteredStations, showAllStations]);

  const hiddenStationCount = filteredStations.length - visibleStations.length;

  const filteredPickerItems = useMemo((): PickerDialItem[] => {
    if (dialFilter === "live" || dialFilter === "featured") return [];
    if (dialFilter === "lists") return pickerItems;
    if (dialFilter === "following")
      return pickerItems.filter((it) =>
        isFollowed(follows, "picker", it.picker.handle),
      );
    return pickerItems;
  }, [dialFilter, pickerItems, follows]);

  const handleGenreClick = (tag: string) => {
    setDialGenre(tag);
  };

  const pulseBySlug = useMemo(() => {
    const map = new Map(
      (pulse?.items ?? []).map((i) => [i.slug, i.nowPlaying ?? null]),
    );
    // Overlay client-side NTS show data when the server has nothing
    // (NTS blocks server-to-server API calls; browser requests work fine).
    const ntsOverlay: [string, typeof nts1Show][] = [
      ["nts-1", nts1Show],
      ["nts-2", nts2Show],
    ];
    for (const [slug, show] of ntsOverlay) {
      if (!show) continue;
      const existing = map.get(slug);
      if (existing?.show) continue; // server already populated show
      const withShow = existing
        ? { ...existing, show: { name: show.showName, djName: show.djName ?? null } }
        : {
            rawArtist: show.djName ?? "",
            rawTitle: show.showName,
            confidence: "unresolved" as const,
            playedAt: new Date().toISOString(),
            show: { name: show.showName, djName: show.djName ?? null },
          };
      map.set(slug, withShow);
    }
    return map;
  }, [pulse, nts1Show, nts2Show]);

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
  const { data: availabilityData } = useGetRecordingsAvailability({ mbids: pulseMbids }, {
    query: {
      queryKey: getGetRecordingsAvailabilityQueryKey({ mbids: pulseMbids }),
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

  // Browser-side fallback for stations with no server-side poller.
  // Polls {streamDomain}/status-json.xsl; activates only when the server
  // returns no now-playing data so there is never a double-call.
  const icecastFallback = useIcecastFallback(
    focusedStation?.streamUrl,
    !!focusedStation && !nowPlaying?.nowPlaying && !selectedDate,
  );

  const handleSelect = (station: Station) => setSelectedSlug(station.slug);
  const handleToggle = (station: Station) => {
    setSelectedSlug(station.slug);
    void player.toggle(station);
  };

  const followingEmpty =
    dialFilter === "following" &&
    filteredStations.length === 0 &&
    filteredPickerItems.length === 0;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
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
        <span className="font-mono text-xs text-muted-foreground" data-testid="dial-station-count">
          {visibleStations.length} station{visibleStations.length === 1 ? "" : "s"}
        </span>
      </div>

      <DialFilter
        active={dialFilter}
        onChange={setDialFilter}
        followCount={dialFollowCount}
      />

      {dialFilter !== "lists" && (
        <DialSortAndGenre
          sort={dialSort}
          onSortChange={setDialSort}
          genre={dialGenre}
          onGenreChange={setDialGenre}
          genreOptions={genreOptions}
          descriptionOnly={descriptionOnly}
          onDescriptionOnlyChange={setDescriptionOnly}
          search={dialSearch}
          onSearchChange={setDialSearch}
        />
      )}

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
      {followingEmpty && (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
          Nothing followed yet — click{" "}
          <span className="font-mono uppercase tracking-wide">Follow</span> on
          any station or list below to see it here.
        </div>
      )}
      {/* Selectors — shown first to give human curation top billing */}
      <SelectorDial items={filteredPickerItems} />

      {!isLoading && visibleStations.length > 0 && (
        <StationList
          stations={visibleStations}
          activeSlug={activeSlug}
          status={player.status}
          pulse={pulseBySlug}
          picked={pickedBySlug}
          schedule={scheduleBySlug}
          recentSpins={recentSpinsBySlug}
          availability={availabilityBySlug}
          featured={dialFilter === "featured"}
          currentShow={selectedDate ? undefined : currentShowBySlug}
          onToggle={handleToggle}
          onSelect={handleSelect}
          onGenreClick={handleGenreClick}
        />
      )}

      {/* Quality-tier toggle — hidden when no stations are being filtered out */}
      {!isLoading && !isError && (hiddenStationCount > 0 || showAllStations) && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={handleShowAllToggle}
            data-testid="dial-show-all-toggle"
            aria-pressed={showAllStations}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {showAllStations ? (
              "Hide low-signal stations"
            ) : (
              <>+ {hiddenStationCount} more station{hiddenStationCount === 1 ? "" : "s"}</>
            )}
          </button>
        </div>
      )}

      {/* Now-playing sidebar only shown in live mode — not meaningful for ghost snapshots */}
      {!selectedDate && (
        <aside className="mt-8 xl:hidden">
          <NowPlaying
            data={nowPlaying}
            isLoading={npLoading}
            fallbackStation={focusedStation}
            clientNowPlaying={icecastFallback}
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
