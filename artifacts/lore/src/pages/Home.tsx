import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import {
  getPickerArchive,
  useListStations,
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
  useListStationsNowPlaying,
  getListStationsNowPlayingQueryKey,
  useListPickers,
  getListPickersQueryKey,
  useGetArchiveRecentRuns,
  getGetArchiveRecentRunsQueryKey,
  useLookupPickedMbids,
  getLookupPickedMbidsQueryKey,
  type Station,
  type Picker,
  type RecentStationRun,
  type PickedLookupItem,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { StationList } from "../components/StationList";
import { NowPlaying } from "../components/NowPlaying";
import { FollowingStrip } from "../components/FollowingStrip";
import { runDate } from "../lib/format";
import {
  AudioLines,
  BookOpen,
  Ghost,
  List,
  Play,
  Radio,
  ShieldCheck,
  UserCheck,
  Waypoints,
} from "lucide-react";

type Mode = "live" | "curated" | "ghost";

const MODES: {
  id: Mode;
  label: string;
  suffix: string;
  Icon: typeof Radio;
  blurb: string;
}[] = [
  {
    id: "live",
    label: "Live",
    suffix: " radio",
    Icon: Radio,
    blurb: "The dial — real stations, unmodified streams, right now.",
  },
  {
    id: "curated",
    label: "Curated",
    suffix: " lists",
    Icon: List,
    blurb: "Editorial playlists — real humans, real picks, in order.",
  },
  {
    id: "ghost",
    label: "Ghost",
    suffix: " radio",
    Icon: Ghost,
    blurb: "Replay documented broadcasts exactly as they aired.",
  },
];

export default function Home() {
  const { radio, ride } = usePlayer();
  const [mode, setMode] = useState<Mode>("live");

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div
        className={`relative z-10 mx-auto max-w-6xl px-4 pt-10 sm:px-6 ${
          ride.active || radio.station ? "pb-32" : "pb-16"
        }`}
      >
        <header className="mb-8">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <AudioLines className="h-4 w-4" />
            Lore Radio
          </div>
          <h1 className="mt-3 max-w-[18ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground sm:text-5xl">
            Borrow real humans' taste. Never an algorithm.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Three ways to listen — live stations, curated lists, and replays of
            documented broadcasts. Every track resolved to its canonical
            identity, with credits and deep links.
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

        <nav
          className="mb-2 flex gap-1 overflow-x-auto rounded-xl border border-card-border bg-card p-1"
          role="tablist"
          aria-label="Listening modes"
        >
          {MODES.map(({ id, label, suffix, Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(id)}
                data-testid={`mode-${id}`}
                className={`hover-elevate inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>
                  {label}
                  <span className="hidden sm:inline">{suffix}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <p className="mb-6 px-1 font-mono text-[11px] text-muted-foreground">
          {MODES.find((m) => m.id === mode)?.blurb}
        </p>

        {mode === "live" && <LiveMode />}
        {mode === "curated" && <CuratedMode />}
        {mode === "ghost" && <GhostMode />}

        <footer className="mt-16 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground">
          Lore never hosts, proxies, or re-encodes audio. Streams are played
          directly from each broadcaster. Track identities and links are provided
          via MusicBrainz and partners.
        </footer>
      </div>
    </div>
  );
}

/** Mode 1 — the live dial with the now-playing sidebar. */
function LiveMode() {
  const { data, isLoading, isError } = useListStations();
  const { radio: player } = usePlayer();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const stations = useMemo(() => data?.stations ?? [], [data]);

  const activeSlug = player.station?.slug ?? null;
  const focusedSlug = selectedSlug ?? activeSlug;
  const focusedStation =
    stations.find((s) => s.slug === focusedSlug) ?? player.station ?? null;

  const { data: pulse } = useListStationsNowPlaying({
    query: {
      queryKey: getListStationsNowPlayingQueryKey(),
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    },
  });
  const pulseBySlug = useMemo(() => {
    return new Map(
      (pulse?.items ?? []).map((i) => [i.slug, i.nowPlaying ?? null]),
    );
  }, [pulse]);

  // Dial badges: batch every resolved now-playing MBID into one lookup —
  // "which of these songs did a critic/label/curator vouch for?" Sorted so
  // the query key (and 60s server cache) stays stable across poll ticks.
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

  const { data: nowPlaying, isLoading: npLoading } = useGetStationNowPlaying(
    focusedSlug ?? "",
    {
      query: {
        queryKey: getGetStationNowPlayingQueryKey(focusedSlug ?? ""),
        enabled: !!focusedSlug,
        refetchInterval: 15000,
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
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-xl font-semibold text-foreground">
            The dial
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
            onToggle={handleToggle}
            onSelect={handleSelect}
          />
        )}
      </section>

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <NowPlaying
          data={nowPlaying}
          isLoading={npLoading}
          fallbackStation={focusedStation}
        />
      </aside>
    </div>
  );
}

/** The freshness summary of a picker's newest documented list. */
interface LatestList {
  runId: number;
  title: string | null;
  pickedAt: string | null;
  trackCount: number;
  resolvedCount: number;
  /** Newest run with at least one resolved track — the one "Replay latest" plays. */
  playableRunId: number | null;
}

/** Picker types that count as curated lists on home. */
const CURATED_TYPES = new Set(["editorial", "blog", "label"]);

/** Mode 2 — editorial, blog, and label playlists from real humans. */
function CuratedMode() {
  const { data, isLoading } = useListPickers(undefined, {
    query: {
      queryKey: getListPickersQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });
  const pickers = (data?.pickers ?? []).filter((p) =>
    CURATED_TYPES.has(p.pickerType),
  );

  // Freshness fan-out: each card shows its picker's newest list (title, date,
  // "x of y playable") from the same archive endpoint the detail page uses.
  const archiveQueries = useQueries({
    queries: pickers.map((p) => ({
      queryKey: ["picker-archive-latest", p.handle],
      queryFn: () => getPickerArchive(p.handle),
      staleTime: 5 * 60 * 1000,
    })),
  });
  const latestByHandle = new Map<string, LatestList>();
  archiveQueries.forEach((q) => {
    const run = q.data?.runs[0];
    if (!q.data || !run) return;
    latestByHandle.set(q.data.picker.handle, {
      runId: run.runId,
      title: run.title ?? null,
      pickedAt: run.pickedAt ?? null,
      trackCount: run.trackCount,
      resolvedCount: run.resolvedCount,
      playableRunId:
        q.data.runs.find((r) => r.resolvedCount > 0)?.runId ?? null,
    });
  });

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-serif text-xl font-semibold text-foreground">
          Curated lists
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          real humans, real picks
        </span>
      </div>
      {isLoading ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-32 animate-pulse rounded-xl border border-card-border bg-card"
            />
          ))}
        </ul>
      ) : pickers.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
          No curated lists yet — they appear as editors document their picks.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pickers.map((picker) => (
            <EditorialPickerCard
              key={picker.id}
              picker={picker}
              latest={latestByHandle.get(picker.handle) ?? null}
            />
          ))}
        </ul>
      )}
      <Link
        href="/archive"
        className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        data-testid="link-all-pickers"
      >
        Browse every archive →
      </Link>
    </section>
  );
}

/** Mode 3 — recent documented runs from every station, ready to replay. */
function GhostMode() {
  const { data, isLoading, isError } = useGetArchiveRecentRuns({
    query: {
      queryKey: getGetArchiveRecentRunsQueryKey(),
      staleTime: 60_000,
    },
  });
  const items = data?.items ?? [];

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-serif text-xl font-semibold text-foreground">
          Recent broadcasts
        </h2>
        <Link
          href="/archive"
          className="font-mono text-xs text-muted-foreground hover:text-primary"
          data-testid="link-archive"
        >
          All archives →
        </Link>
      </div>
      {isLoading ? (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="h-[74px] animate-pulse rounded-xl border border-card-border bg-card"
            />
          ))}
        </ul>
      ) : isError ? (
        <div className="rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground">
          Couldn't load recent broadcasts. Please refresh.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
          Nothing documented yet — runs appear as station archives fill in.
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="ghost-runs">
          {items.map((item) => (
            <RecentRunCard key={item.run.runId} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentRunCard({ item }: { item: RecentStationRun }) {
  const { station, run } = item;
  const replayable = run.resolvedCount > 0;
  return (
    <li>
      <div className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4">
        <Link
          href={`/archive/station-runs/${run.runId}`}
          className="min-w-0 flex-1"
          data-testid={`ghost-run-${run.runId}`}
        >
          <p className="truncate font-serif text-base font-semibold text-foreground">
            {run.show?.name ?? "Station stream"}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {station.name}
            {run.show?.djName ? ` · ${run.show.djName}` : ""} ·{" "}
            {runDate(run.date)} · {run.spinCount} track
            {run.spinCount === 1 ? "" : "s"} ·{" "}
            <span className={replayable ? "text-primary" : ""}>
              {run.resolvedCount}/{run.spinCount} resolved
            </span>
          </p>
        </Link>
        {replayable ? (
          <Link
            href={`/archive/station-runs/${run.runId}?play=1`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground hover:opacity-90"
            data-testid={`ghost-play-${run.runId}`}
          >
            <Play className="h-3 w-3" />
            Replay
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function EditorialPickerCard({
  picker,
  latest,
}: {
  picker: Picker;
  latest: LatestList | null;
}) {
  // Replay targets the newest run with playable tracks — the freshness block
  // above may honestly show a newer, not-yet-resolved list.
  const replayRunId = latest
    ? latest.playableRunId
    : (picker.latestRunId ?? null);
  return (
    <li className="flex flex-col">
      <div className="hover-elevate flex h-full flex-col gap-2 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-primary-border">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/archive/pickers/${picker.handle}`}
            className="font-semibold leading-tight text-foreground hover:text-primary"
          >
            {picker.name}
          </Link>
          <List className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        {picker.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {picker.description}
          </p>
        )}
        {latest && (
          <div
            className="rounded-lg border border-border bg-background/60 px-3 py-2"
            data-testid={`picker-latest-${picker.handle}`}
          >
            <p className="line-clamp-1 text-xs font-medium text-foreground">
              {latest.title ?? "Latest list"}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {latest.pickedAt ? `${runDate(latest.pickedAt)} · ` : ""}
              <span className={latest.resolvedCount > 0 ? "text-primary" : ""}>
                {latest.resolvedCount} of {latest.trackCount} playable
              </span>
            </p>
          </div>
        )}
        <div className="mt-auto flex items-center gap-3">
          {replayRunId != null ? (
            <Link
              href={`/archive/picker-runs/${replayRunId}?play=1`}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground bg-primary rounded-full px-3 py-1.5 hover:opacity-90"
            >
              <Play className="h-3 w-3" />
              Replay latest
            </Link>
          ) : null}
          <Link
            href={`/archive/pickers/${picker.handle}`}
            className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-primary"
          >
            Browse all →
          </Link>
        </div>
      </div>
    </li>
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
